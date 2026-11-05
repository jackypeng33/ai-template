// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ selects: [] as unknown[][], writes: [] as { table: unknown; value: Record<string, unknown> }[],
  lease: new Date("2026-11-05T00:02:00Z"), inference: vi.fn(), exists: vi.fn() }));
vi.mock("@/lib/rap/storage", () => ({ objectExists: mocks.exists, getRapSignedUrl: vi.fn() }));
vi.mock("@/lib/rap/seeapi", () => ({ rapModerationReady: () => true, queryModeration: mocks.inference, submitModeration: vi.fn(), createModerationBody: vi.fn() }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit", "for"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(mocks.selects.shift() || []);
    return chain;
  };
  const db = { select, transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    update: (table: unknown) => ({ set: (value: Record<string, unknown>) => {
      mocks.writes.push({ table, value });
      return { where: () => ({ then: (resolve: (value: unknown) => unknown) => resolve([]), returning: async () => [row()] }) };
    } }), insert: () => ({ values: () => ({ onConflictDoNothing: async () => [] }) }) };
  return { db };
});
import { rapGeneration, rapModeration } from "@/lib/db/schema";
import { processRapModeration, signedRequestExpired } from "@/lib/rap/moderation";
function row() { return { id: "mod", userId: "user", generationId: "gen", assetId: null, mediaHash: "hash", storageKey: "key",
  policyVersion: "seeapi-strict-v1", providerTaskId: "provider", status: "processing", idempotencyKey: "key", attempts: 1,
  requestBody: null, leaseUntil: mocks.lease, createdAt: new Date(), updatedAt: new Date(), nextRunAt: new Date(), reason: null }; }
const generation = { id: "gen", orderId: "order", status: "moderating", resultKey: "key", mediaHash: "hash" };
const image = { flagged: false, output: { nsfw_detected: false, scope: "sampled_frames", sampling_complete: true,
  checked_frames: 1, flagged_frame_count: 0, timestamp_source: "frame_index_div_fps_estimate", output_layout: "named-files-v1", report_schema_version: 5,
  frames: [{ frame_number: 1, timestamp_seconds: 0, nsfw_detected: false, nsfw: [] }] } };
beforeEach(() => {
  mocks.selects.length = 0; mocks.writes.length = 0; mocks.inference.mockClear(); mocks.exists.mockResolvedValue(true);
  mocks.inference.mockResolvedValue({ status: "succeeded", error: null, result: { type: "json", data: image } });
});
describe("moderation delivery transaction", () => {
  it("does not deliver a stale policy even if the provider approved it", async () => {
    mocks.selects.push([{ ...row(), policyVersion: "old" }], [generation], [{ status: "paid" }], [generation], [{ ...row(), policyVersion: "old" }]);
    await processRapModeration(1);
    expect(mocks.writes.filter(w => w.table === rapGeneration)).toHaveLength(0);
  });
  it("cannot approve a missing generation", async () => {
    mocks.selects.push([row()], [], [row()]);
    await processRapModeration(1);
    expect(mocks.writes.find(w => w.table === rapModeration && w.value.status === "error")?.value.reason).toBe("MEDIA_UNAVAILABLE");
  });
  it("recognizes expired signed bodies without regenerating them", () => {
    const body = JSON.stringify({ input: { image_url: "https://example.com/file?X-Amz-Date=20261105T000000Z&X-Amz-Expires=3600" } });
    expect(signedRequestExpired(body, Date.parse("2026-11-05T00:20:00Z"))).toBe(false);
    expect(signedRequestExpired(body, Date.parse("2026-11-05T01:00:00Z"))).toBe(true);
    expect(signedRequestExpired("broken")).toBe(true);
  });
  it("does not finalize a stale lease", async () => {
    mocks.selects.push([row()], [generation], [{ status: "paid" }], [generation], [{ ...row(), leaseUntil: new Date(0) }]);
    await processRapModeration(1);
    expect(mocks.writes.filter(w => w.table === rapGeneration)).toHaveLength(0);
  });
  it("does not reactivate a refunded order", async () => {
    mocks.selects.push([row()], [generation], [{ status: "refunded" }], [generation], [row()]);
    await processRapModeration(1);
    expect(mocks.writes.filter(w => w.table === rapGeneration)).toHaveLength(0);
    expect(mocks.writes.find(w => w.table === rapModeration && w.value.status === "error")?.value.reason).toBe("RESULT_NOT_DELIVERABLE");
  });
  it("does not extend expiry after an already finalized result", async () => {
    mocks.selects.push([row()], [generation], [{ status: "paid" }], [{ ...generation, status: "succeeded" }], [{ ...row(), status: "approved" }]);
    await processRapModeration(1);
    expect(mocks.writes.filter(w => w.table === rapGeneration)).toHaveLength(0);
  });
  it("publishes a clean paid result with an expiry only once", async () => {
    mocks.selects.push([row()], [generation], [{ status: "paid" }], [generation], [row()]);
    await processRapModeration(1);
    const write = mocks.writes.find(w => w.table === rapGeneration);
    expect(write?.value.status).toBe("succeeded");
    expect(write?.value.resultExpiresAt).toBeInstanceOf(Date);
  });
});
