import { db } from "@/lib/db";
import { billingOrder } from "@/lib/db/schema";
import { isPackKey, oneTimePacks } from "@/constants/billing";
import { and, eq, isNull, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  capturePayPalOrder, createPayPalOrder, getPayPalCapture, getPayPalConfig,
  getPayPalOrder, getPayPalReturnUrl, PayPalError, type PayPalOrder,
} from "./paypal";
import { validatePayPalOrder } from "./paypal-validation";
import { settlePayPalCapture } from "./settlement";

export async function getOwnedPayPalOrder(id: string, userId: string) {
  const [order] = await db.select().from(billingOrder).where(and(
    eq(billingOrder.id, id), eq(billingOrder.userId, userId), eq(billingOrder.provider, "paypal"),
  )).limit(1);
  if (!order) throw new PayPalError(404, "ORDER_NOT_FOUND");
  return order;
}

function checkEnvironment(order: typeof billingOrder.$inferSelect) {
  const config = getPayPalConfig();
  if (order.environment !== config.environment || order.merchantId !== config.merchantId) {
    throw new PayPalError(409, "PAYPAL_ENVIRONMENT_MISMATCH");
  }
}

async function bindRemoteOrder(order: typeof billingOrder.$inferSelect, remote: PayPalOrder) {
  checkEnvironment(order);
  validatePayPalOrder(order, remote);
  await db.update(billingOrder).set({ providerOrderId: remote.id })
    .where(and(eq(billingOrder.id, order.id), isNull(billingOrder.providerOrderId)));
  const [bound] = await db.select().from(billingOrder).where(eq(billingOrder.id, order.id)).limit(1);
  if (!bound || bound.providerOrderId !== remote.id) throw new PayPalError(409, "PAYPAL_ORDER_MISMATCH");
  return bound;
}

export async function startPayPalCheckout(userId: string, key: string, requestId: string, locale: string) {
  const config = getPayPalConfig();
  if (!isPackKey(key) || !Object.hasOwn(oneTimePacks, key)) throw new PayPalError(400, "INVALID_PACK");
  const pack = oneTimePacks[key];
  await db.insert(billingOrder).values({
    id: randomUUID(), userId, provider: "paypal", requestId, packKey: key,
    amountCents: pack.priceCents, currency: pack.currency, credits: pack.credits,
    merchantId: config.merchantId, environment: config.environment, locale,
  }).onConflictDoNothing({ target: [billingOrder.userId, billingOrder.requestId] });
  const [order] = await db.select().from(billingOrder).where(and(
    eq(billingOrder.userId, userId), eq(billingOrder.requestId, requestId),
  )).limit(1);
  if (!order || order.provider !== "paypal" || order.packKey !== key) throw new PayPalError(409, "REQUEST_CONFLICT");
  checkEnvironment(order);
  if (order.status === "succeeded") return { orderId: order.id, url: getPayPalReturnUrl(order.id, order.locale) };
  if (order.approvalUrl) return { orderId: order.id, url: order.approvalUrl };
  // PayPal's default request-id retention is finite. Never recreate an ambiguous
  // old order automatically after that window; reconcile it before starting over.
  if (!order.providerOrderId && Date.now() - order.createdAt.getTime() > 5 * 60 * 60 * 1000) throw new PayPalError(409, "ORDER_REQUIRES_REVIEW");
  const created = order.providerOrderId ? null : await createPayPalOrder(order);
  // Always fetch the full resource: successful POST responses may omit fields
  // needed for fulfillment even when representation was requested.
  const remote = await getPayPalOrder(order.providerOrderId || created!.id);
  await bindRemoteOrder(order, remote);
  const approvalUrl = (created?.links || remote.links)?.find(link => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!approvalUrl) throw new PayPalError(502, "PAYPAL_APPROVAL_MISSING");
  const url = new URL(approvalUrl);
  const expectedHost = config.environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com";
  if (url.protocol !== "https:" || url.hostname !== expectedHost) throw new PayPalError(502, "PAYPAL_APPROVAL_INVALID");
  await db.update(billingOrder).set({ approvalUrl, updatedAt: new Date() })
    .where(eq(billingOrder.id, order.id));
  return { orderId: order.id, url: approvalUrl };
}

export async function completePayPalOrder(localOrderId: string) {
  const [order] = await db.select().from(billingOrder).where(and(
    eq(billingOrder.id, localOrderId), eq(billingOrder.provider, "paypal"),
  )).limit(1);
  if (!order) throw new PayPalError(404, "ORDER_NOT_FOUND");
  checkEnvironment(order);
  if (order.status === "succeeded") return order;
  if (!order.providerOrderId) return order;
  let remote = await getPayPalOrder(order.providerOrderId);
  validatePayPalOrder(order, remote);
  if (remote.status === "APPROVED") {
    let captureError: unknown;
    try {
      await capturePayPalOrder(remote.id, order.id);
    } catch (error) {
      // Another request may already have captured it, or the response was lost.
      // Re-read before deciding whether to retry; always reuse the capture key.
      captureError = error;
    }
    remote = await getPayPalOrder(order.providerOrderId);
    if (captureError && remote.status !== "COMPLETED") throw captureError;
  }
  if (remote.status === "COMPLETED") {
    const captures = remote.purchase_units[0]?.payments?.captures ?? [];
    if (captures.length !== 1) throw new PayPalError(409, "PAYPAL_CAPTURE_MISMATCH");
    const capture = await getPayPalCapture(captures[0].id);
    if (capture.status === "COMPLETED") return settlePayPalCapture(order.id, remote, capture);
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status)) {
      throw new PayPalError(409, "ORDER_REQUIRES_REVIEW");
    }
    if (["DECLINED", "FAILED"].includes(capture.status)) {
      await db.update(billingOrder).set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(billingOrder.id, order.id), ne(billingOrder.status, "succeeded")));
      return { ...order, status: "failed" };
    }
  }
  // APPROVED is not paid; PENDING funding never grants credits.
  await db.update(billingOrder).set({ status: "pending", updatedAt: new Date() })
    .where(and(eq(billingOrder.id, order.id), ne(billingOrder.status, "succeeded")));
  return { ...order, status: "pending" };
}

// Verified notifications may arrive before the create-order response was saved.
export async function resolvePayPalNotificationOrder(providerOrderId: string) {
  const remote = await getPayPalOrder(providerOrderId);
  const localId = remote.purchase_units[0]?.custom_id;
  if (!localId) return null;
  const [order] = await db.select().from(billingOrder).where(and(
    eq(billingOrder.id, localId), eq(billingOrder.provider, "paypal"),
  )).limit(1);
  // Ignore other products handled by the same merchant application.
  if (!order) return null;
  return bindRemoteOrder(order, remote);
}

export function publicPayPalOrder(order: typeof billingOrder.$inferSelect) {
  return { id: order.id, status: order.status, packKey: order.packKey, credits: order.credits };
}
