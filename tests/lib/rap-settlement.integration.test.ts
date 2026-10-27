// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { user, rapAsset, rapOrder, rapGeneration, rapAudit, payment } from "@/lib/db/schema";
const holder = vi.hoisted(() => ({ db: undefined as unknown as typeof import("@/lib/db").db }));
const provider = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn(), upload: vi.fn(), put: vi.fn(), get: vi.fn(), remove: vi.fn(), email: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ get db() { return holder.db; } }));
vi.mock("@/lib/rap/kie", () => ({ createKieTask: provider.create, queryKieTask: provider.query, uploadKieAsset: provider.upload }));
vi.mock("@/lib/rap/storage", () => ({ putRapObject: provider.put, getRapObject: provider.get, deleteRapObject: provider.remove }));
vi.mock("@/lib/email", () => ({ sendEmail: provider.email }));
import { failRapGeneration, retryRapGeneration, settleRapPayment } from "@/lib/rap/repository";
import { processRapJobs, sendRapNotifications } from "@/lib/rap/worker";
import { createRapSnapshot } from "@/lib/rap/snapshot";
import { remoteOrder, capture } from "./paypal-fixtures";

const testUrl = process.env.RAP_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("BOOTH durable orders and job queue in PostgreSQL", () => {
  const namespace = `rap_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof postgres>; let client: ReturnType<typeof postgres>;
  const left = randomUUID(), right = randomUUID(), orderId = `rap_${randomUUID()}`;
  const remote = { ...remoteOrder, purchase_units: [{ ...remoteOrder.purchase_units[0], custom_id: orderId, reference_id: orderId }] };
  const receipt = { ...capture, custom_id: orderId };
  beforeAll(async () => {
    admin = postgres(testUrl!, { prepare: false, max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
    client = postgres(testUrl!, { prepare: false, max: 8, onnotice: () => {}, connection: { search_path: namespace } });
    holder.db = drizzle(client, { schema });
    for (const file of readdirSync("drizzle").filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      for (const statement of readFileSync(`drizzle/${file}`, "utf8").replaceAll('"public".', `"${namespace}".`).split("--> statement-breakpoint")) if (statement.trim()) await client.unsafe(statement);
    }
  }, 60_000);
  afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (client) await client.end(); if (admin) { await admin.unsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await admin.end(); } });
  beforeEach(async () => {
    provider.create.mockReset(); provider.query.mockReset(); provider.upload.mockReset();
    provider.put.mockReset(); provider.get.mockReset(); provider.remove.mockReset();
    provider.email.mockReset();
    provider.upload.mockResolvedValue("https://tempfile.redpandaai.co/ref.jpg"); provider.get.mockResolvedValue(Buffer.from("reference"));
    provider.create.mockResolvedValue("TASK-1");
    vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "false");
    await client.unsafe("TRUNCATE rap_feedback, rap_audit, rap_generation, rap_order, rap_asset, payment, \"user\" CASCADE");
    await holder.db.insert(user).values({ id: "buyer", name: "Buyer", email: "buyer@local.test", credits: 300 });
    for (const id of [left, right]) await holder.db.insert(rapAsset).values({ id, userId: "buyer", storageKey: `rap/${id}/${id}.jpg`, width: 800, height: 1000, expiresAt: new Date(Date.now() + 3600_000) });
    await holder.db.insert(rapOrder).values({ id: orderId, userId: "buyer", requestId: randomUUID(), leftAssetId: left, rightAssetId: right,
      snapshot: await createRapSnapshot(), amountCents: 500, currency: "usd", merchantId: "merchant", environment: "sandbox", providerOrderId: remote.id });
  });
  it("fulfills a captured purchase once under concurrent notification/return; leaves general credits unchanged", async () => {
    await Promise.all(Array.from({ length: 8 }, () => settleRapPayment(orderId, remote, receipt)));
    expect(await holder.db.select().from(payment)).toHaveLength(1);
    expect(await holder.db.select().from(rapGeneration)).toHaveLength(1);
    expect((await holder.db.select().from(user))[0].credits).toBe(300);
    expect((await holder.db.select().from(rapOrder))[0]).toMatchObject({ status: "paid", retryCredits: 0 });
  });
  it("rolls the payment back if the initial durable job cannot be written", async () => {
    await client.unsafe("CREATE FUNCTION reject_rap_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced'; END; $$");
    await client.unsafe("CREATE TRIGGER reject_rap_job BEFORE INSERT ON rap_generation FOR EACH ROW EXECUTE FUNCTION reject_rap_job()");
    try {
      await expect(settleRapPayment(orderId, remote, receipt)).rejects.toThrow();
      expect(await holder.db.select().from(payment)).toHaveLength(0);
      expect((await holder.db.select().from(rapOrder))[0].status).toBe("created");
    } finally { await client.unsafe("DROP TRIGGER reject_rap_job ON rap_generation"); await client.unsafe("DROP FUNCTION reject_rap_job()"); }
    await settleRapPayment(orderId, remote, receipt); expect(await holder.db.select().from(rapGeneration)).toHaveLength(1);
  });
  it("does not grant or queue for a mismatched amount or pending capture", async () => {
    await expect(settleRapPayment(orderId, remote, { ...receipt, status: "PENDING" })).rejects.toThrow();
    await expect(settleRapPayment(orderId, remote, { ...receipt, amount: { value: "0.01", currency_code: "USD" } })).rejects.toThrow();
    expect(await holder.db.select().from(payment)).toHaveLength(0); expect(await holder.db.select().from(rapGeneration)).toHaveLength(0);
  });
  it("returns one replacement under repeated concurrent failures and consumes it once", async () => {
    await settleRapPayment(orderId, remote, receipt); const [initial] = await holder.db.select().from(rapGeneration);
    await Promise.all(Array.from({ length: 8 }, () => failRapGeneration(initial.id, "PROVIDER_FAILED")));
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(1);
    const input = { requestId: randomUUID(), leftAssetId: left, rightAssetId: right };
    const tasks = await Promise.all(Array.from({ length: 8 }, () => retryRapGeneration(orderId, "buyer", input)));
    expect(new Set(tasks.map(t => t.id)).size).toBe(1);
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(0);
    expect(await holder.db.select().from(rapGeneration)).toHaveLength(2);
    expect((await holder.db.select().from(rapAudit)).filter(e => e.kind === "failure_replacement")).toHaveLength(1);
  });
  it("prevents another user from using an order or its photos", async () => {
    await settleRapPayment(orderId, remote, receipt); const [initial] = await holder.db.select().from(rapGeneration); await failRapGeneration(initial.id, "PROVIDER_FAILED");
    await expect(retryRapGeneration(orderId, "other", { requestId: randomUUID(), leftAssetId: left, rightAssetId: right })).rejects.toThrow("ORDER_NOT_FOUND");
    await holder.db.update(rapAsset).set({ expiresAt: new Date(0) }).where(eq(rapAsset.id, left));
    await expect(retryRapGeneration(orderId, "buyer", { requestId: randomUUID(), leftAssetId: left, rightAssetId: right })).rejects.toThrow("PHOTOS_EXPIRED");
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(1);
  });
  it("does not contact the video provider while the global generation switch is off", async () => {
    await settleRapPayment(orderId, remote, receipt);
    expect(await processRapJobs()).toMatchObject({ generationDisabled: true, processed: 0 });
    expect(provider.create).not.toHaveBeenCalled(); expect(provider.query).not.toHaveBeenCalled(); expect(provider.upload).not.toHaveBeenCalled();
  });
  it("recovers an expired submitting lease as unknown without buying another generation", async () => {
    await settleRapPayment(orderId, remote, receipt); const [initial] = await holder.db.select().from(rapGeneration);
    await holder.db.update(rapGeneration).set({ status: "submitting", leaseUntil: new Date(0) }).where(eq(rapGeneration.id, initial.id));
    vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true"); await processRapJobs(1);
    expect((await holder.db.select().from(rapGeneration))[0].status).toBe("submission_unknown");
    expect(provider.create).not.toHaveBeenCalled(); expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(0);
  });
  it("does not queue a replacement after a refund or payment review", async () => {
    await settleRapPayment(orderId, remote, receipt); const [initial] = await holder.db.select().from(rapGeneration); await failRapGeneration(initial.id, "PROVIDER_FAILED");
    await holder.db.update(rapOrder).set({ status: "refunded" }).where(eq(rapOrder.id, orderId));
    await expect(retryRapGeneration(orderId, "buyer", { requestId: randomUUID(), leftAssetId: left, rightAssetId: right })).rejects.toThrow("NO_REPLACEMENT_AVAILABLE");
  });
  it("submits a queued job once and saves the provider task ID", async () => {
    await settleRapPayment(orderId, remote, receipt); vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true");
    await processRapJobs(1); await processRapJobs(1);
    expect(provider.create).toHaveBeenCalledTimes(1); expect(provider.upload).toHaveBeenCalledTimes(3);
    expect((await holder.db.select().from(rapGeneration))[0]).toMatchObject({ status: "waiting", providerTaskId: "TASK-1" });
  });
  it("does not resubmit or return an opportunity when the create response is lost", async () => {
    await settleRapPayment(orderId, remote, receipt); vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true");
    provider.create.mockRejectedValue(new Error("network response lost"));
    await processRapJobs(1); await processRapJobs(1);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect((await holder.db.select().from(rapGeneration))[0].status).toBe("submission_unknown");
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(0);
  });
  async function queryableTask() {
    await settleRapPayment(orderId, remote, receipt); vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true");
    const [task] = await holder.db.select().from(rapGeneration);
    await holder.db.update(rapGeneration).set({ providerTaskId: "TASK-1", status: "waiting", submittedAt: new Date() }).where(eq(rapGeneration.id, task.id));
    return task;
  }
  it("keeps querying the original task after a result download fails", async () => {
    await queryableTask(); provider.query.mockResolvedValue({ state: "success", resultUrl: "https://tempfile.aiquickdraw.com/video.mp4", creditsConsumed: 30 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await processRapJobs(1);
    expect(provider.create).not.toHaveBeenCalled();
    expect((await holder.db.select().from(rapGeneration))[0]).toMatchObject({ status: "waiting", providerTaskId: "TASK-1" });
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(0);
  });
  it("only announces success after a provider result is stored privately", async () => {
    const task = await queryableTask(); provider.query.mockResolvedValue({ state: "success", resultUrl: "https://tempfile.aiquickdraw.com/video.mp4", creditsConsumed: 30 });
    // Deliberately synthetic container header; never exposed as a real sample.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("0000ftypisom000000000000"))));
    await processRapJobs(1);
    expect(provider.put).toHaveBeenCalledTimes(1);
    expect((await holder.db.select().from(rapGeneration))[0]).toMatchObject({ status: "succeeded", resultKey: `rap/${task.id}/${task.id}.mp4`, providerCredits: "30" });
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(0); expect(provider.create).not.toHaveBeenCalled();
  });
  it("turns a verified provider failure into exactly one replacement", async () => {
    await queryableTask(); provider.query.mockResolvedValue({ state: "fail" }); await processRapJobs(1); await processRapJobs(1);
    expect((await holder.db.select().from(rapGeneration))[0].status).toBe("failed");
    expect((await holder.db.select().from(rapOrder))[0].retryCredits).toBe(1); expect(provider.create).not.toHaveBeenCalled();
  });
  it("does not mark provider-rejected mail as sent, and retries without changing the video", async () => {
    await settleRapPayment(orderId, remote, receipt); const [task] = await holder.db.select().from(rapGeneration);
    await holder.db.update(rapGeneration).set({ status: "succeeded", resultExpiresAt: new Date(Date.now() + 3600_000) }).where(eq(rapGeneration.id, task.id));
    provider.email.mockResolvedValueOnce({ success: true, data: { error: { message: "Rejected by email service" } } });
    await sendRapNotifications(); expect((await holder.db.select().from(rapGeneration))[0].emailSentAt).toBeNull();
    await holder.db.update(rapGeneration).set({ emailAttemptedAt: new Date(0) }).where(eq(rapGeneration.id, task.id));
    provider.email.mockResolvedValueOnce({ success: true, data: { error: null, data: { id: "sent" } } });
    await sendRapNotifications(); const [saved] = await holder.db.select().from(rapGeneration);
    expect(saved.emailSentAt).not.toBeNull(); expect(saved.status).toBe("succeeded"); expect(provider.create).not.toHaveBeenCalled();
  });
});
