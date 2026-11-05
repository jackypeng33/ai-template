import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapGeneration, rapOrder, rapAsset, rapFeedback, rapMetric, rapModeration, rapUpload, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { RAP_PRODUCT, RapError, rapGenerationEnabled } from "./config";
import { afterHours, failRapGeneration, type RapGeneration } from "./repository";
import { getRapObject, deleteRapObject, persistRapVideo } from "./storage";
import { uploadKieAsset, createKieTask, queryKieTask } from "./kie";
import { safeProviderUrl } from "./validation";
import { completeRapPayment } from "./payments";
import { assertRapAssetsApproved, assertRapVideoApproved, queueRapModeration } from "./moderation";
import { verifiedRapMusic } from "./snapshot";

async function defer(task: RapGeneration, error?: string) {
  await db.update(rapGeneration).set({ leaseUntil: null, nextRunAt: new Date(Date.now() + 30_000),
    updatedAt: new Date(), ...(error ? { error } : {}) }).where(and(eq(rapGeneration.id, task.id), eq(rapGeneration.leaseUntil, task.leaseUntil!)));
}
async function runTask(task: RapGeneration) {
  if (["moderating", "content_rejected", "succeeded", "expired"].includes(task.status)) return;
  const [order] = await db.select().from(rapOrder).where(eq(rapOrder.id, task.orderId));
  if (!order || order.status !== "paid") {
    await db.update(rapGeneration).set({ status: "requires_review", error: "PAYMENT_REVIEW", leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id)); return;
  }
  if (["submitting", "submission_unknown"].includes(task.status) && !task.providerTaskId) {
    // No known task ID after a crash/timeout: DO NOT call createTask again.
    await db.update(rapGeneration).set({ status: "submission_unknown", error: "SUBMISSION_UNKNOWN", leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id)); return;
  }
  if (task.status === "requires_review" && !task.providerTaskId) { await defer(task); return; }
  if (!task.providerTaskId) {
    const assets = await db.select().from(rapAsset).where(inArray(rapAsset.id, [task.leftAssetId, task.rightAssetId]));
    const left = assets.find(a => a.id === task.leftAssetId); const right = assets.find(a => a.id === task.rightAssetId);
    if (!left?.storageKey || !right?.storageKey || [left, right].some(a => a.expiresAt <= new Date())) {
      await failRapGeneration(task.id, "PHOTOS_EXPIRED"); return;
    }
    try { await assertRapAssetsApproved(assets); } catch { await defer(task, "PHOTO_MODERATION_REQUIRED"); return; }
    // Repeating preparation is safe: it cannot purchase another video.
    const audio = await verifiedRapMusic(task.snapshot);
    const leftUrl = await uploadKieAsset(await getRapObject(left.storageKey), `${randomUUID()}.jpg`, "image/jpeg");
    const rightUrl = await uploadKieAsset(await getRapObject(right.storageKey), `${randomUUID()}.jpg`, "image/jpeg");
    const audioUrl = await uploadKieAsset(audio, `${randomUUID()}.wav`, "audio/wav");
    const claimed = await db.update(rapGeneration).set({ status: "submitting", submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(rapGeneration.id, task.id), eq(rapGeneration.leaseUntil, task.leaseUntil!), eq(rapGeneration.status, "preparing"))).returning();
    if (!claimed.length) return;
    try {
      const providerTaskId = await createKieTask(leftUrl, rightUrl, audioUrl);
      await db.update(rapGeneration).set({ providerTaskId, status: "waiting", error: null, leaseUntil: null,
        nextRunAt: new Date(Date.now() + 10_000), updatedAt: new Date() }).where(eq(rapGeneration.id, task.id));
    } catch {
      await db.update(rapGeneration).set({ status: "submission_unknown", error: "SUBMISSION_UNKNOWN", leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id));
    }
    return;
  }
  const result = await queryKieTask(task.providerTaskId);
  if (result.state === "fail") { await failRapGeneration(task.id, "PROVIDER_FAILED"); return; }
  if (result.state === "success" && result.resultUrl) {
    // Never expose a short-lived provider URL or substitute a concept poster.
    const response = await fetch(safeProviderUrl(result.resultUrl), { redirect: "error", signal: AbortSignal.timeout(60_000), cache: "no-store" });
    const key = `rap/${task.id}/${randomUUID()}.mp4`;
    const { mediaHash } = await persistRapVideo(response, key);
    let retained = false;
    try { await db.transaction(async tx => {
      const [lockedOrder] = await tx.select().from(rapOrder).where(eq(rapOrder.id, task.orderId)).for("update");
      const [current] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, task.id)).for("update");
      if (current.leaseUntil?.getTime() !== task.leaseUntil?.getTime() || ["succeeded", "expired", "failed", "moderating", "content_rejected"].includes(current.status)) return;
      if (lockedOrder.status !== "paid") {
        await tx.update(rapGeneration).set({ status: "requires_review", error: "LATE_RESULT_PAYMENT_REVIEW", leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id)); return;
      }
      await tx.update(rapGeneration).set({ status: "moderating", resultKey: key, mediaHash, persistedAt: new Date(),
        providerCredits: result.creditsConsumed == null ? null : String(result.creditsConsumed), error: null, leaseUntil: null,
        updatedAt: new Date() }).where(eq(rapGeneration.id, task.id));
      await queueRapModeration(tx, { userId: task.userId, generationId: task.id, mediaHash, storageKey: key });
      retained = true;
    }); } finally { if (!retained) await deleteRapObject(key); }
    return;
  }
  const needsReview = Date.now() - (task.submittedAt || task.createdAt).getTime() > RAP_PRODUCT.reviewMinutes * 60_000;
  await db.update(rapGeneration).set({ status: needsReview ? "requires_review" : result.state === "generating" ? "generating" : "waiting",
    error: needsReview ? "PROCESSING_DELAYED" : null, leaseUntil: null, nextRunAt: new Date(Date.now() + 15_000), updatedAt: new Date() })
    .where(and(eq(rapGeneration.id, task.id), eq(rapGeneration.leaseUntil, task.leaseUntil!)));
}

export async function processRapJobs(limit = 5) {
  if (!rapGenerationEnabled() || process.env.RAP_MODERATION_ENABLED !== "true" || !process.env.SEEAPI_API_KEY) return { processed: 0, generationDisabled: true };
  let processed = 0;
  for (let i = 0; i < Math.min(limit, 10); i++) {
    const task = await db.transaction(async tx => {
      const [row] = await tx.select().from(rapGeneration).where(and(
        inArray(rapGeneration.status, ["queued", "preparing", "submitting", "waiting", "generating", "persisting", "requires_review"]),
        lte(rapGeneration.nextRunAt, new Date()), or(isNull(rapGeneration.leaseUntil), lt(rapGeneration.leaseUntil, new Date())),
      )).orderBy(rapGeneration.nextRunAt).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(rapGeneration).set({ leaseUntil: afterHours(0.1),
        status: row.status === "queued" ? "preparing" : row.status }).where(eq(rapGeneration.id, row.id)).returning(); return claimed;
    });
    if (!task) break;
    try { await runTask(task); } catch (error) {
      if (error instanceof RapError && error.code === "TEMPLATE_REQUIRES_REVIEW") {
        await db.update(rapGeneration).set({ status: "requires_review", error: error.code, leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id));
      } else await defer(task, error instanceof RapError ? error.code : "PROCESSING_RETRY");
    }
    processed++;
  }
  return { processed, generationDisabled: false };
}

export async function reconcileRapOrders(limit = 1) {
  const pending = await db.select().from(rapOrder).where(and(isNull(rapOrder.paymentId), isNotNull(rapOrder.providerOrderId),
    inArray(rapOrder.status, ["created"]), gt(rapOrder.createdAt, afterHours(-24)), lt(rapOrder.updatedAt, new Date(Date.now() - 60_000))))
    .orderBy(rapOrder.updatedAt).limit(Math.min(Math.max(limit, 1), 5));
  for (const order of pending) {
    try { await completeRapPayment(order.id); } catch { /* Webhook retries and owner sync remain available. */ }
    await db.update(rapOrder).set({ updatedAt: new Date() }).where(eq(rapOrder.id, order.id));
  }
  return pending.length;
}

export async function sendRapNotifications() {
  const tasks = await db.select({ task: rapGeneration, email: user.email }).from(rapGeneration).innerJoin(user, eq(user.id, rapGeneration.userId))
    .where(and(eq(rapGeneration.status, "succeeded"), isNull(rapGeneration.emailSentAt), gt(rapGeneration.resultExpiresAt, new Date()),
      or(isNull(rapGeneration.emailAttemptedAt), lt(rapGeneration.emailAttemptedAt, new Date(Date.now() - 15 * 60_000))))).limit(10);
  for (const { task, email } of tasks) {
    try { await assertRapVideoApproved(task); } catch { continue; }
    const [order] = await db.select().from(rapOrder).where(eq(rapOrder.id, task.orderId));
    if (order?.status !== "paid") continue;
    const claim = await db.update(rapGeneration).set({ emailAttemptedAt: new Date() }).where(and(eq(rapGeneration.id, task.id),
      or(isNull(rapGeneration.emailAttemptedAt), lt(rapGeneration.emailAttemptedAt, new Date(Date.now() - 15 * 60_000))))).returning();
    if (!claim.length) continue;
    const link = new URL(`/rap?order=${task.orderId}`, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString();
    const result = await sendEmail({ to: email, subject: "Your BOOTH video is ready", text:
      `Your duo is ready. Sign in to watch and download: ${link}\nDownload before ${task.resultExpiresAt!.toISOString()}. Your video is kept for 7 days. Reply to support if you need help.` });
    if (result.success && !("data" in result && result.data?.error)) await db.update(rapGeneration).set({ emailSentAt: new Date() }).where(eq(rapGeneration.id, task.id));
  }
  const support = process.env.RAP_SUPPORT_EMAIL;
  if (support) {
    const feedback = await db.select({ item: rapFeedback, email: user.email }).from(rapFeedback).innerJoin(user, eq(user.id, rapFeedback.userId))
      .where(isNull(rapFeedback.emailSentAt)).limit(10);
    for (const { item, email } of feedback) {
      const result = await sendEmail({ to: support, replyTo: email, subject: `BOOTH ${item.request}: ${item.orderId}`, text: `Feedback ${item.id}\nOrder ${item.orderId}\nCustomer ${email}\n${item.message}` });
      if (result.success && !("data" in result && result.data?.error)) await db.update(rapFeedback).set({ emailSentAt: new Date() }).where(eq(rapFeedback.id, item.id));
    }
  }
  return tasks.length;
}

export async function cleanupRapMedia() {
  await db.delete(rapMetric).where(lt(rapMetric.createdAt, afterHours(-24 * 30)));
  // Apply the terminal deadline only once; repeated cron runs must not extend it.
  const ended = await db.select().from(rapGeneration).where(and(isNotNull(rapGeneration.finishedAt), inArray(rapGeneration.status, ["succeeded", "failed", "expired", "content_rejected"])));
  for (const task of ended) {
    const deadline = afterHours(RAP_PRODUCT.terminalPhotoHours, task.finishedAt!);
    // Shared assets are not removed while another active task still needs them.
    const active = await db.select().from(rapGeneration).where(and(
      or(inArray(rapGeneration.leftAssetId, [task.leftAssetId, task.rightAssetId]), inArray(rapGeneration.rightAssetId, [task.leftAssetId, task.rightAssetId])),
      inArray(rapGeneration.status, ["queued", "preparing", "submitting", "submission_unknown", "waiting", "generating", "persisting", "moderating", "requires_review"]),
    )).limit(1);
    if (!active.length) await db.update(rapAsset).set({ expiresAt: deadline }).where(and(inArray(rapAsset.id, [task.leftAssetId, task.rightAssetId]), gt(rapAsset.expiresAt, deadline)));
  }
  const expired = await db.select().from(rapAsset).where(and(lte(rapAsset.expiresAt, new Date()), isNotNull(rapAsset.storageKey))).limit(50);
  for (const asset of expired) {
    try { await deleteRapObject(asset.storageKey!); await db.update(rapAsset).set({ storageKey: null }).where(eq(rapAsset.id, asset.id)); }
    catch { /* Keep the key for the next cleanup retry. */ }
  }
  const videos = await db.select().from(rapGeneration).where(and(lte(rapGeneration.resultExpiresAt, new Date()), isNotNull(rapGeneration.resultKey))).limit(20);
  for (const task of videos) {
    try { await deleteRapObject(task.resultKey!); await db.update(rapGeneration).set({ resultKey: null, status: "expired" }).where(eq(rapGeneration.id, task.id)); }
    catch { /* Keep for retry. */ }
  }
  // Isolated media has its own deadline; no approved expiry is needed to clean it.
  const isolated = await db.select().from(rapGeneration).where(and(isNotNull(rapGeneration.resultKey),
    isNull(rapGeneration.moderatedAt), or(lt(rapGeneration.persistedAt, afterHours(-24 * 7)),
      and(eq(rapGeneration.status, "content_rejected"), lt(rapGeneration.finishedAt, afterHours(-24)))))).limit(20);
  for (const task of isolated) {
    await db.transaction(async tx => {
      await tx.select().from(rapOrder).where(eq(rapOrder.id, task.orderId)).for("update");
      const [current] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, task.id)).for("update");
      if (!current?.resultKey || current.moderatedAt) return;
      await deleteRapObject(current.resultKey);
      await tx.update(rapGeneration).set({ resultKey: null, status: "expired", finishedAt: new Date() }).where(eq(rapGeneration.id, task.id));
      await tx.update(rapModeration).set({ status: "error", reason: "MEDIA_EXPIRED", leaseUntil: null }).where(eq(rapModeration.generationId, task.id));
    });
  }
  const uploads = await db.select().from(rapUpload).where(lte(rapUpload.expiresAt, new Date())).limit(30);
  for (const upload of uploads) {
    try { await deleteRapObject(upload.storageKey); await db.delete(rapUpload).where(eq(rapUpload.id, upload.id)); } catch { /* retry next cron */ }
  }
  return { photos: expired.length, videos: videos.length };
}

// Queue still-valid legacy media in bounded batches.
// Reading bytes does not submit a generation or grant any payment rights.
export async function queueExistingRapMedia() {
  if (process.env.RAP_MODERATION_ENABLED !== "true") return;
  const photos = await db.select().from(rapAsset).where(and(isNotNull(rapAsset.storageKey), isNull(rapAsset.mediaHash), gt(rapAsset.expiresAt, new Date()))).limit(5);
  for (const asset of photos) {
    const hash = asset.mediaHash || createHash("sha256").update(await getRapObject(asset.storageKey!)).digest("hex");
    await db.transaction(async tx => {
      const [current] = await tx.select().from(rapAsset).where(eq(rapAsset.id, asset.id)).for("update");
      if (!current.storageKey || current.expiresAt <= new Date()) return;
      if (!current.mediaHash) await tx.update(rapAsset).set({ mediaHash: hash }).where(eq(rapAsset.id, current.id));
      await queueRapModeration(tx, { userId: current.userId, assetId: current.id, mediaHash: hash, storageKey: current.storageKey });
    });
  }
  const videos = await db.select().from(rapGeneration).where(and(eq(rapGeneration.status, "succeeded"),
    isNull(rapGeneration.moderatedAt), isNotNull(rapGeneration.resultKey), gt(rapGeneration.resultExpiresAt, new Date()))).limit(2);
  for (const task of videos) {
    const hash = createHash("sha256").update(await getRapObject(task.resultKey!)).digest("hex");
    await db.transaction(async tx => {
      await tx.select().from(rapOrder).where(eq(rapOrder.id, task.orderId)).for("update");
      const [current] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, task.id)).for("update");
      if (current.status !== "succeeded" || current.moderatedAt || !current.resultKey) return;
      await tx.update(rapGeneration).set({ mediaHash: hash, status: "moderating", persistedAt: new Date(), resultExpiresAt: null }).where(eq(rapGeneration.id, current.id));
      await queueRapModeration(tx, { userId: current.userId, generationId: current.id, mediaHash: hash, storageKey: current.resultKey });
    });
  }

}
