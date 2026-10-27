import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapAsset, rapOrder, rapGeneration, rapAudit, payment } from "@/lib/db/schema";
import { RAP_PRODUCT, RapError } from "./config";
import { putRapObject } from "./storage";
import { validatePayPalCapture } from "@/lib/payments/paypal-validation";
import type { PayPalOrder, PayPalCapture } from "@/lib/payments/paypal";

export type RapOrder = typeof rapOrder.$inferSelect;
export type RapGeneration = typeof rapGeneration.$inferSelect;
export const activeStatuses = ["queued", "preparing", "submitting", "submission_unknown", "waiting", "generating", "persisting", "requires_review"];
export const afterHours = (hours: number, now = new Date()) => new Date(now.getTime() + hours * 3600_000);

export async function normalizePortrait(bytes: Buffer) {
  if (!bytes.length || bytes.length > RAP_PRODUCT.maxImageBytes) throw new RapError(400, "PHOTO_SIZE_INVALID");
  try {
    const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false, failOn: "warning" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1 ||
        !meta.width || !meta.height || meta.width < 300 || meta.height < 300 ||
        meta.width / meta.height < 0.4 || meta.width / meta.height > 2.5) throw new Error("Invalid image");
    const { data, info } = await image.rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).toColourspace("srgb").jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch { throw new RapError(400, "PHOTO_INVALID"); }
}
export async function savePortrait(userId: string, bytes: Buffer) {
  const normalized = await normalizePortrait(bytes); const id = randomUUID();
  const key = `rap/${randomUUID()}/${id}.jpg`;
  await putRapObject(key, normalized.data, "image/jpeg");
  const [asset] = await db.insert(rapAsset).values({ id, userId, storageKey: key,
    width: normalized.width, height: normalized.height, expiresAt: afterHours(RAP_PRODUCT.draftHours) }).returning();
  return { assetId: asset.id, width: asset.width, height: asset.height, expiresAt: asset.expiresAt };
}

export async function assertAssets(userId: string, left: string, right: string, executor = db) {
  const ids = [...new Set([left, right])];
  const assets = await executor.select().from(rapAsset).where(and(eq(rapAsset.userId, userId), inArray(rapAsset.id, ids), gt(rapAsset.expiresAt, new Date())));
  if (assets.length !== ids.length || assets.some(a => !a.storageKey)) throw new RapError(409, "PHOTOS_EXPIRED");
  return assets;
}
export async function ownedOrder(id: string, userId: string) {
  const [order] = await db.select().from(rapOrder).where(and(eq(rapOrder.id, id), eq(rapOrder.userId, userId)));
  if (!order) throw new RapError(404, "ORDER_NOT_FOUND"); return order;
}

// Payment and initial durable queue record commit together. No provider call in tx.
export async function settleRapPayment(orderId: string, remote: PayPalOrder, capture: PayPalCapture) {
  return db.transaction(async tx => {
    const [order] = await tx.select().from(rapOrder).where(eq(rapOrder.id, orderId)).for("update");
    if (!order) throw new RapError(404, "ORDER_NOT_FOUND");
    validatePayPalCapture(order, remote, capture);
    const id = `paypal:${capture.id}`;
    if (order.paymentId) {
      if (order.paymentId !== id) throw new RapError(409, "PAYMENT_CONFLICT"); return order;
    }
    if (["refunded", "requires_review"].includes(order.status)) throw new RapError(409, "ORDER_REQUIRES_REVIEW");
    await tx.insert(payment).values({ id, provider: "paypal", providerPaymentId: id, userId: order.userId,
      amountCents: order.amountCents, currency: order.currency, status: "succeeded", type: "one_time", creditsGranted: 0,
      raw: JSON.stringify({ rapOrderId: order.id, captureId: capture.id }) });
    await tx.insert(rapGeneration).values({ id: randomUUID(), orderId, userId: order.userId, requestId: `initial:${order.id}`,
      leftAssetId: order.leftAssetId, rightAssetId: order.rightAssetId, snapshot: order.snapshot });
    await tx.update(rapAsset).set({ expiresAt: afterHours(24 * RAP_PRODUCT.unknownPhotoDays) })
      .where(inArray(rapAsset.id, [order.leftAssetId, order.rightAssetId]));
    await tx.insert(rapAudit).values({ id: `paid:${orderId}`, orderId, kind: "payment_settled", note: id });
    const [saved] = await tx.update(rapOrder).set({ paymentId: id, status: "paid", updatedAt: new Date() })
      .where(eq(rapOrder.id, orderId)).returning(); return saved;
  });
}

export async function retryRapGeneration(orderId: string, userId: string, input: { requestId: string; leftAssetId: string; rightAssetId: string }) {
  return db.transaction(async tx => {
    const [order] = await tx.select().from(rapOrder).where(and(eq(rapOrder.id, orderId), eq(rapOrder.userId, userId))).for("update");
    if (!order) throw new RapError(404, "ORDER_NOT_FOUND");
    const [existing] = await tx.select().from(rapGeneration).where(and(eq(rapGeneration.userId, userId), eq(rapGeneration.requestId, input.requestId)));
    if (existing) {
      if (existing.orderId !== orderId || existing.leftAssetId !== input.leftAssetId || existing.rightAssetId !== input.rightAssetId) throw new RapError(409, "REQUEST_CONFLICT");
      return existing;
    }
    if (order.status !== "paid" || order.retryCredits < 1) throw new RapError(409, "NO_REPLACEMENT_AVAILABLE");
    const active = await tx.select({ id: rapGeneration.id }).from(rapGeneration).where(and(eq(rapGeneration.orderId, orderId), inArray(rapGeneration.status, activeStatuses))).limit(1);
    if (active.length) throw new RapError(409, "TASK_ALREADY_ACTIVE");
    await assertAssets(userId, input.leftAssetId, input.rightAssetId, tx as unknown as typeof db);
    const [generation] = await tx.insert(rapGeneration).values({ ...input, id: randomUUID(), orderId, userId, snapshot: order.snapshot }).returning();
    await tx.update(rapOrder).set({ retryCredits: sql`${rapOrder.retryCredits} - 1`, updatedAt: new Date() }).where(eq(rapOrder.id, orderId));
    await tx.update(rapAsset).set({ expiresAt: afterHours(24 * RAP_PRODUCT.unknownPhotoDays) })
      .where(inArray(rapAsset.id, [input.leftAssetId, input.rightAssetId]));
    await tx.insert(rapAudit).values({ id: `retry:${generation.id}`, orderId, generationId: generation.id, kind: "replacement_used" });
    return generation;
  });
}

export async function failRapGeneration(id: string, code: string) {
  const [found] = await db.select().from(rapGeneration).where(eq(rapGeneration.id, id)); if (!found) return;
  await db.transaction(async tx => {
    const [order] = await tx.select().from(rapOrder).where(eq(rapOrder.id, found.orderId)).for("update");
    const [task] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, id)).for("update");
    if (!task || ["failed", "succeeded", "expired"].includes(task.status)) return;
    await tx.update(rapGeneration).set({ status: "failed", error: code, finishedAt: new Date(), leaseUntil: null, updatedAt: new Date() }).where(eq(rapGeneration.id, id));
    if (order.status === "paid") {
      const grant = await tx.insert(rapAudit).values({ id: `failure:${id}`, orderId: order.id, generationId: id, kind: "failure_replacement" }).onConflictDoNothing().returning();
      if (grant.length) await tx.update(rapOrder).set({ retryCredits: sql`${rapOrder.retryCredits} + 1` }).where(eq(rapOrder.id, order.id));
    }
  });
}
