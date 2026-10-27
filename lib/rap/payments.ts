import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapOrder, paymentEvent, rapAudit } from "@/lib/db/schema";
import { getPayPalConfig, getPayPalOrder, getPayPalCapture, capturePayPalOrder, paypalRequest, paypalOrderSchema } from "@/lib/payments/paypal";
import { validatePayPalOrder } from "@/lib/payments/paypal-validation";
import { RAP_PRODUCT, RapError, assertRapCheckoutReady } from "./config";
import { assertAssets, ownedOrder, settleRapPayment, type RapOrder } from "./repository";
import type { checkoutSchema } from "./validation";
import type { z } from "zod";
import { createRapSnapshot } from "./snapshot";

function checkConfig(order: RapOrder) {
  const config = getPayPalConfig();
  if (order.merchantId !== config.merchantId || order.environment !== config.environment) throw new RapError(409, "PAYMENT_ENVIRONMENT_MISMATCH");
  return config;
}
export function rapReturnUrl(id: string, cancelled = false) {
  const config = getPayPalConfig();
  const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  if (!["http:", "https:"].includes(app.protocol) || (config.environment === "live" && app.protocol !== "https:")) throw new RapError(503, "APP_URL_INVALID");
  const url = new URL("/rap", app.origin); url.searchParams.set("order", id);
  if (cancelled) url.searchParams.set("cancelled", "1"); return url.toString();
}
async function bind(order: RapOrder, remote: Awaited<ReturnType<typeof getPayPalOrder>>) {
  checkConfig(order); validatePayPalOrder(order, remote);
  await db.update(rapOrder).set({ providerOrderId: remote.id, updatedAt: new Date() })
    .where(and(eq(rapOrder.id, order.id), isNull(rapOrder.providerOrderId)));
  const [saved] = await db.select().from(rapOrder).where(eq(rapOrder.id, order.id));
  if (saved.providerOrderId !== remote.id) throw new RapError(409, "PAYMENT_CONFLICT"); return saved;
}
export async function startRapCheckout(userId: string, input: z.infer<typeof checkoutSchema>) {
  assertRapCheckoutReady(); const config = getPayPalConfig();
  // Retry an existing request before checking the TTL of its original assets.
  let [order] = await db.select().from(rapOrder).where(and(eq(rapOrder.userId, userId), eq(rapOrder.requestId, input.requestId)));
  if (!order) {
    await assertAssets(userId, input.leftAssetId, input.rightAssetId);
    await db.insert(rapOrder).values({ id: `rap_${randomUUID()}`, userId, requestId: input.requestId,
      leftAssetId: input.leftAssetId, rightAssetId: input.rightAssetId, snapshot: await createRapSnapshot(),
      amountCents: RAP_PRODUCT.priceCents, currency: RAP_PRODUCT.currency, merchantId: config.merchantId, environment: config.environment,
    }).onConflictDoNothing({ target: [rapOrder.userId, rapOrder.requestId] });
    [order] = await db.select().from(rapOrder).where(and(eq(rapOrder.userId, userId), eq(rapOrder.requestId, input.requestId)));
  }
  if (order.leftAssetId !== input.leftAssetId || order.rightAssetId !== input.rightAssetId) throw new RapError(409, "REQUEST_CONFLICT");
  checkConfig(order);
  if (order.paymentId) return { orderId: order.id, url: rapReturnUrl(order.id) };
  if (["refunded", "requires_review"].includes(order.status)) throw new RapError(409, "ORDER_REQUIRES_REVIEW");
  if (order.approvalUrl) return { orderId: order.id, url: order.approvalUrl };
  if (!order.providerOrderId && Date.now() - order.createdAt.getTime() > 5 * 3600_000) throw new RapError(409, "ORDER_REQUIRES_REVIEW");
  const summary = order.providerOrderId ? null : paypalOrderSchema.pick({ id: true, links: true }).parse(await paypalRequest("/v2/checkout/orders", "POST", {
    intent: "CAPTURE", purchase_units: [{ reference_id: order.id, custom_id: order.id,
      description: "BOOTH — one 8-second duo rap video", payee: { merchant_id: order.merchantId },
      amount: { currency_code: "USD", value: (order.amountCents / 100).toFixed(2) } }],
    payment_source: { paypal: { experience_context: { shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
      return_url: rapReturnUrl(order.id), cancel_url: rapReturnUrl(order.id, true) } } },
  }, `booth-${order.id}`));
  const remote = await getPayPalOrder(order.providerOrderId || summary!.id); await bind(order, remote);
  const link = (summary?.links || remote.links)?.find(l => ["payer-action", "approve"].includes(l.rel))?.href;
  if (!link) throw new RapError(502, "PAYMENT_LINK_MISSING");
  const url = new URL(link);
  if (url.protocol !== "https:" || url.hostname !== (config.environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com")) throw new RapError(502, "PAYMENT_LINK_INVALID");
  await db.update(rapOrder).set({ approvalUrl: link }).where(eq(rapOrder.id, order.id));
  return { orderId: order.id, url: link };
}

export async function completeRapPayment(id: string, userId?: string) {
  const order = userId ? await ownedOrder(id, userId) : (await db.select().from(rapOrder).where(eq(rapOrder.id, id)))[0];
  if (!order) throw new RapError(404, "ORDER_NOT_FOUND"); checkConfig(order);
  if (order.paymentId || ["refunded", "requires_review"].includes(order.status) || !order.providerOrderId) return order;
  let remote = await getPayPalOrder(order.providerOrderId); validatePayPalOrder(order, remote);
  if (remote.status === "APPROVED") {
    await assertAssets(order.userId, order.leftAssetId, order.rightAssetId);
    try { await capturePayPalOrder(remote.id, order.id); } catch { /* Authoritative re-read recovers a lost capture response. */ }
    remote = await getPayPalOrder(remote.id);
  }
  if (remote.status === "COMPLETED") {
    const captures = remote.purchase_units[0]?.payments?.captures || [];
    if (captures.length !== 1) throw new RapError(409, "PAYMENT_CONFLICT");
    const capture = await getPayPalCapture(captures[0].id);
    if (capture.status === "COMPLETED") return settleRapPayment(order.id, remote, capture);
    if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(capture.status)) {
      await db.update(rapOrder).set({ status: "requires_review" }).where(eq(rapOrder.id, order.id));
    }
  }
  return order;
}

export async function processRapWebhook(event: { id: string; event_type: string; resource: { id: string; supplementary_data?: { related_ids?: { order_id?: string } } } }) {
  const eventId = `rap:paypal:${event.id}`;
  const [old] = await db.select().from(paymentEvent).where(eq(paymentEvent.id, eventId));
  if (old && ["processed", "ignored", "requires_review"].includes(old.status)) return;
  await db.insert(paymentEvent).values({ id: eventId, provider: "paypal", eventType: event.event_type, resourceId: event.resource.id }).onConflictDoNothing();
  try {
    let remoteId: string | undefined;
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") remoteId = event.resource.id;
    else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") remoteId = (await getPayPalCapture(event.resource.id)).supplementary_data?.related_ids?.order_id;
    else if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(event.event_type)) {
      // Refund resources differ. Resolve by the authoritative capture link/ID;
      // unresolvable events remain in durable review rather than being ignored.
      const resource = event.resource as { supplementary_data?: { related_ids?: { capture_id?: string } }; links?: { rel: string; href: string }[] };
      let captureId = resource.supplementary_data?.related_ids?.capture_id;
      if (!captureId) {
        const base = getPayPalConfig().baseUrl;
        const up = resource.links?.find(link => link.rel === "up")?.href;
        if (up?.startsWith(`${base}/v2/payments/captures/`)) {
          const candidate = up.slice(`${base}/v2/payments/captures/`.length);
          if (/^[a-zA-Z0-9]+$/.test(candidate)) captureId = candidate;
        }
      }
      if (event.event_type === "PAYMENT.CAPTURE.REVERSED" && !captureId) captureId = event.resource.id;
      if (captureId) {
        // Fetch from the trusted API, then lock the order before freezing rights.
        const capture = await getPayPalCapture(captureId);
        const providerOrderId = capture.supplementary_data?.related_ids?.order_id;
        if (!providerOrderId) throw new RapError(502, "PAYMENT_REFERENCE_MISSING");
        const remote = await getPayPalOrder(providerOrderId);
        const localId = remote.purchase_units[0]?.custom_id;
        if (localId?.startsWith("rap_")) await db.transaction(async tx => {
          const [order] = await tx.select().from(rapOrder).where(eq(rapOrder.id, localId)).for("update");
          if (order) {
            checkConfig(order); validatePayPalOrder(order, remote);
            await tx.update(rapOrder).set({ status: "requires_review", retryCredits: 0 }).where(eq(rapOrder.id, order.id));
          }
        });
      }
      await db.update(paymentEvent).set({ status: "requires_review" }).where(eq(paymentEvent.id, eventId)); return;
    }
    if (!remoteId) { await db.update(paymentEvent).set({ status: "ignored" }).where(eq(paymentEvent.id, eventId)); return; }
    const remote = await getPayPalOrder(remoteId); const localId = remote.purchase_units[0]?.custom_id;
    const [order] = localId ? await db.select().from(rapOrder).where(eq(rapOrder.id, localId)) : [];
    if (order) {
      await bind(order, remote); const result = await completeRapPayment(order.id);
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && !result.paymentId) throw new RapError(502, "PAYMENT_PENDING");
      await db.insert(rapAudit).values({ id: `webhook:${event.id}`, orderId: order.id, kind: "payment_webhook" }).onConflictDoNothing();
    }
    await db.update(paymentEvent).set({ providerOrderId: remoteId, status: order ? "processed" : "ignored", error: null }).where(eq(paymentEvent.id, eventId));
  } catch (error) {
    await db.update(paymentEvent).set({ status: "failed", error: "Replay notification or reconcile order" }).where(eq(paymentEvent.id, eventId)); throw error;
  }
}
