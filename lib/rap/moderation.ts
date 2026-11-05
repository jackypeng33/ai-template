import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapAsset, rapModeration, rapGeneration, rapOrder, rapAudit } from "@/lib/db/schema";
import { RapError, RAP_PRODUCT } from "./config";
import { getRapSignedUrl, objectExists } from "./storage";
import { MODERATION_POLICY_VERSION, assessModeration } from "./moderation-policy";
import { createModerationBody, queryModeration, submitModeration, rapModerationReady } from "./seeapi";
export { MODERATION_POLICY_VERSION } from "./moderation-policy";

type Executor = Pick<typeof db, "select" | "insert">;
type Media = { id: string; mediaHash: string | null };
type Moderation = typeof rapModeration.$inferSelect;
const later = (ms: number) => new Date(Date.now() + ms);

export async function queueRapModeration(executor: Pick<typeof db, "insert">, input: {
  userId: string; assetId?: string; generationId?: string; mediaHash: string; storageKey: string;
}) {
  const id = randomUUID();
  await executor.insert(rapModeration).values({ ...input, id, idempotencyKey: `rap-moderation:${id}`,
    policyVersion: MODERATION_POLICY_VERSION }).onConflictDoNothing();
}
async function assertApproved(media: Media, video: boolean, executor: Executor = db) {
  if (!media.mediaHash) throw new RapError(409, "CONTENT_REQUIRES_MODERATION");
  const [row] = await executor.select().from(rapModeration).where(and(
    eq(video ? rapModeration.generationId : rapModeration.assetId, media.id),
    eq(rapModeration.mediaHash, media.mediaHash), eq(rapModeration.policyVersion, MODERATION_POLICY_VERSION),
  )).limit(1);
  if (!row || row.status !== "approved") throw new RapError(409,
    row?.status === "rejected" ? "CONTENT_REJECTED" : row?.status === "error" ? "MODERATION_REQUIRES_REVIEW" : "CONTENT_MODERATION_PENDING");
}
export async function assertRapAssetsApproved(assets: Media[], executor: Executor = db) {
  for (const asset of assets) await assertApproved(asset, false, executor);
}
export async function assertRapVideoApproved(task: Media, executor: Executor = db) { await assertApproved(task, true, executor); }

async function finish(row: Moderation, status: "approved" | "rejected" | "error", reason: string | null) {
  await db.transaction(async tx => {
    // Preserve global ordering: order, generation, moderation. No network work inside these locks.
    let generation: typeof rapGeneration.$inferSelect | undefined;
    let paid = false;
    if (row.generationId) {
      const [found] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, row.generationId));
      if (found) {
        const [order] = await tx.select().from(rapOrder).where(eq(rapOrder.id, found.orderId)).for("update");
        [generation] = await tx.select().from(rapGeneration).where(eq(rapGeneration.id, found.id)).for("update");
        paid = order?.status === "paid";
      }
    }
    const [current] = await tx.select().from(rapModeration).where(eq(rapModeration.id, row.id)).for("update");
    if (!current || current.leaseUntil?.getTime() !== row.leaseUntil?.getTime() || ["approved", "rejected", "error"].includes(current.status)) return;
    if (row.policyVersion !== MODERATION_POLICY_VERSION || current.policyVersion !== MODERATION_POLICY_VERSION) { status = "error"; reason = "MODERATION_POLICY_CHANGED"; }
    if (row.assetId) {
      const [asset] = await tx.select().from(rapAsset).where(eq(rapAsset.id, row.assetId));
      if (!asset?.storageKey || asset.mediaHash !== row.mediaHash || asset.expiresAt <= new Date()) { status = "error"; reason = "MEDIA_UNAVAILABLE"; }
    }
    if (row.generationId && !generation) { status = "error"; reason = "MEDIA_UNAVAILABLE"; }
    if (generation && (generation.mediaHash !== row.mediaHash || generation.resultKey !== row.storageKey || !paid || generation.status !== "moderating")) {
      status = "error"; reason = "RESULT_NOT_DELIVERABLE";
    }
    await tx.update(rapModeration).set({ status, reason, ...(status !== "error" ? { requestBody: null } : {}), leaseUntil: null, updatedAt: new Date() }).where(eq(rapModeration.id, row.id));
    if (!generation || generation.status !== "moderating" || generation.mediaHash !== row.mediaHash) return;
    if (status === "approved" && paid) {
      await tx.update(rapGeneration).set({ status: "succeeded", moderatedAt: new Date(), finishedAt: new Date(),
        resultExpiresAt: later(RAP_PRODUCT.videoDays * 86400_000), error: null, leaseUntil: null, updatedAt: new Date() }).where(eq(rapGeneration.id, generation.id));
      await tx.insert(rapAudit).values({ id: `result:${generation.id}`, orderId: generation.orderId, generationId: generation.id, kind: "video_ready" }).onConflictDoNothing();
    } else if (status === "rejected") {
      await tx.update(rapGeneration).set({ status: "content_rejected", finishedAt: new Date(), error: "CONTENT_REJECTED", leaseUntil: null, updatedAt: new Date() }).where(eq(rapGeneration.id, generation.id));
      await tx.insert(rapAudit).values({ id: `moderation-rejected:${generation.id}`, orderId: generation.orderId, generationId: generation.id, kind: "content_rejected" }).onConflictDoNothing();
    }
  });
}
async function run(row: Moderation) {
  const kind = row.generationId ? "video" : "image";
  if (!await objectExists(row.storageKey)) { await finish(row, "error", "MEDIA_UNAVAILABLE"); return; }
  let result;
  if (row.providerTaskId) result = await queryModeration(kind, row.providerTaskId);
  else {
    let body = row.requestBody;
    if (!body) {
      body = createModerationBody(kind, await getRapSignedUrl(row.storageKey, 3600));
      const saved = await db.update(rapModeration).set({ requestBody: body, status: "submitting", updatedAt: new Date() })
        .where(and(eq(rapModeration.id, row.id), eq(rapModeration.leaseUntil, row.leaseUntil!))).returning();
      if (!saved.length) return;
    }
    result = await submitModeration(kind, body, row.idempotencyKey);
    const saved = await db.update(rapModeration).set({ providerTaskId: result.id, status: "processing", updatedAt: new Date() })
      .where(and(eq(rapModeration.id, row.id), eq(rapModeration.leaseUntil, row.leaseUntil!))).returning();
    if (!saved.length) return;
  }
  if (result.status === "succeeded" && result.error === null) {
    const verdict = result.result?.type === "json" ? assessModeration(kind, result.result.data) : "unresolved";
    await finish(row, verdict === "unresolved" ? "error" : verdict, verdict === "unresolved" ? "MODERATION_REPORT_INVALID" : verdict === "rejected" ? "CONTENT_REJECTED" : null);
  } else if (!["queued", "processing"].includes(result.status)) await finish(row, "error", "MODERATION_PROVIDER_FAILED");
  else await db.update(rapModeration).set({ leaseUntil: null, nextRunAt: later(30_000), updatedAt: new Date() })
    .where(and(eq(rapModeration.id, row.id), eq(rapModeration.leaseUntil, row.leaseUntil!)));
}
export async function processRapModeration(limit = 2) {
  if (!rapModerationReady()) return { moderated: 0, moderationDisabled: true };
  let moderated = 0;
  for (let i = 0; i < Math.min(Math.max(limit, 0), 10); i++) {
    const row = await db.transaction(async tx => {
      const [found] = await tx.select().from(rapModeration).where(and(
        inArray(rapModeration.status, ["pending", "submitting", "processing"]), lte(rapModeration.nextRunAt, new Date()),
        or(isNull(rapModeration.leaseUntil), lt(rapModeration.leaseUntil, new Date())),
      )).orderBy(rapModeration.nextRunAt).limit(1).for("update", { skipLocked: true });
      if (!found) return null;
      const [claimed] = await tx.update(rapModeration).set({ leaseUntil: later(90_000), attempts: found.attempts + 1 })
        .where(eq(rapModeration.id, found.id)).returning();
      return claimed;
    });
    if (!row) break;
    try {
      // Never mutate an expired signed request under the same idempotency key. Operator review is required.
      if (row.policyVersion !== MODERATION_POLICY_VERSION) await finish(row, "error", "MODERATION_POLICY_CHANGED");
      else if (row.attempts > 60 || (!row.providerTaskId && row.requestBody && signedRequestExpired(row.requestBody))) await finish(row, "error", "MODERATION_REQUIRES_REVIEW");
      else await run(row);
    } catch (error) {
      const code = error instanceof RapError ? error.code : "MODERATION_RETRY";
      const terminal = error instanceof RapError && error.status !== 503 || row.attempts >= 8;
      if (terminal) await finish(row, "error", code);
      else await db.update(rapModeration).set({ reason: code, leaseUntil: null, nextRunAt: later(Math.min(300_000, 15_000 * 2 ** Math.min(row.attempts, 5))), updatedAt: new Date() })
        .where(and(eq(rapModeration.id, row.id), eq(rapModeration.leaseUntil, row.leaseUntil!)));
    }
    moderated++;
  }
  return { moderated, moderationDisabled: false };
}


// Submission timeouts must recover the original request, never issue a new paid inference blindly.
export function signedRequestExpired(body: string, now = Date.now()) {
  try {
    const input = JSON.parse(body).input;
    const url = new URL(input.image_url || input.video_url);
    const stamp = url.searchParams.get("X-Amz-Date");
    const expires = Number(url.searchParams.get("X-Amz-Expires"));
    if (!stamp || !/^\d{8}T\d{6}Z$/.test(stamp) || !expires) return true;
    const started = Date.parse(`${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(9,11)}:${stamp.slice(11,13)}:${stamp.slice(13,15)}Z`);
    return now >= started + expires * 1000 - 60_000;
  } catch { return true; }
}
export async function retryRapModeration(id: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(rapModeration).where(eq(rapModeration.id, id)).for("update");
    if (!row || row.status !== "error") throw new RapError(409, "MODERATION_NOT_RETRYABLE");
    if (!row.providerTaskId && row.requestBody && signedRequestExpired(row.requestBody)) throw new RapError(409, "MODERATION_SUBMISSION_UNKNOWN");
    await tx.update(rapModeration).set({ status: row.providerTaskId ? "processing" : "pending", reason: null,
      attempts: 0, leaseUntil: null, nextRunAt: new Date(), updatedAt: new Date() }).where(eq(rapModeration.id, row.id));
  });
}
