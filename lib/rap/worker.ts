import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapGeneration, rapOrder, rapAsset, rapAudit, rapFeedback, rapMetric, user } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { RAP_PRODUCT, RapError, rapGenerationEnabled } from "./config";
import { afterHours, failRapGeneration, type RapGeneration } from "./repository";
import { getRapObject, putRapObject, deleteRapObject } from "./storage";
import { uploadKieAsset, createKieTask, queryKieTask } from "./kie";
import { readLimited, safeProviderUrl } from "./validation";
import { completeRapPayment } from "./payments";
import { verifiedRapMusic } from "./snapshot";

async function defer(task: RapGeneration, error?: string) {
  await db.update(rapGeneration).set({ leaseUntil: null, nextRunAt: new Date(Date.now() + 30_000),
    updatedAt: new Date(), ...(error ? { error } : {}) }).where(and(eq(rapGeneration.id, task.id), eq(rapGeneration.leaseUntil, task.leaseUntil!)));
}
async function runTask(task: RapGeneration) {
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
    const bytes = await readLimited(response, 150 * 1024 * 1024);
    if (bytes.length < 16 || !bytes.subarray(0, 100).includes(Buffer.from("ftyp"))) throw new RapError(502, "VIDEO_INVALID");
    const key = `rap/${task.id}/${task.id}.mp4`; await putRapObject(key, bytes, "video/mp4");
    await db.transaction(async tx => {
      const [lockedOrder] = await tx.select().from(rapOrder).where(eq(rapOrder.id, task.orderId)).for("update");
      const [current] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, task.id)).for("update");
      if (["succeeded", "expired", "failed"].includes(current.status)) return;
      if (lockedOrder.status !== "paid") {
        await tx.update(rapGeneration).set({ status: "requires_review", error: "LATE_RESULT_PAYMENT_REVIEW", leaseUntil: null, nextRunAt: afterHours(24) }).where(eq(rapGeneration.id, task.id)); return;
      }
      await tx.update(rapGeneration).set({ status: "succeeded", resultKey: key, resultExpiresAt: afterHours(24 * RAP_PRODUCT.videoDays),
        finishedAt: new Date(), providerCredits: result.creditsConsumed == null ? null : String(result.creditsConsumed), error: null, leaseUntil: null, updatedAt: new Date() }).where(eq(rapGeneration.id, task.id));
      await tx.insert(rapAudit).values({ id: `result:${task.id}`, orderId: task.orderId, generationId: task.id, kind: "video_ready" }).onConflictDoNothing();
    });
    return;
  }
  const needsReview = Date.now() - (task.submittedAt || task.createdAt).getTime() > RAP_PRODUCT.reviewMinutes * 60_000;
  await db.update(rapGeneration).set({ status: needsReview ? "requires_review" : result.state === "generating" ? "generating" : "waiting",
    error: needsReview ? "PROCESSING_DELAYED" : null, leaseUntil: null, nextRunAt: new Date(Date.now() + 15_000), updatedAt: new Date() })
    .where(and(eq(rapGeneration.id, task.id), eq(rapGeneration.leaseUntil, task.leaseUntil!)));
}

export async function processRapJobs(limit = 5) {
  if (!rapGenerationEnabled()) return { processed: 0, generationDisabled: true };
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
  const ended = await db.select().from(rapGeneration).where(and(isNotNull(rapGeneration.finishedAt), inArray(rapGeneration.status, ["succeeded", "failed", "expired"])));
  for (const task of ended) {
    const deadline = afterHours(RAP_PRODUCT.terminalPhotoHours, task.finishedAt!);
    // Shared assets are not removed while another active task still needs them.
    const active = await db.select().from(rapGeneration).where(and(
      or(inArray(rapGeneration.leftAssetId, [task.leftAssetId, task.rightAssetId]), inArray(rapGeneration.rightAssetId, [task.leftAssetId, task.rightAssetId])),
      inArray(rapGeneration.status, ["queued", "preparing", "submitting", "submission_unknown", "waiting", "generating", "persisting", "requires_review"]),
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
  return { photos: expired.length, videos: videos.length };
}
