// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { billingOrder, creditLedger, payment, subscription, subscriptionCreditGrant, user } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { localOrder, remoteOrder, capture } from "./paypal-fixtures";

const holder = vi.hoisted(() => ({ database: undefined as unknown as typeof import("@/lib/db").db }));
const api = vi.hoisted(() => ({ plan: vi.fn(), create: vi.fn(), remote: vi.fn(), ids: [] as string[] }));
vi.mock("@/lib/db", () => ({ get db() { return holder.database; } }));
vi.mock("@/lib/payments/paypal-subscription-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/paypal-subscription-api")>(),
  getPayPalPlan: api.plan, createPayPalSubscription: api.create, getPayPalSubscription: api.remote,
}));
import { settlePayPalCapture } from "@/lib/payments/settlement";
import { applyPayPalSubscriptionState, processDuePayPalGrants, settlePayPalSubscriptionPayment, startPayPalSubscription } from "@/lib/payments/paypal-subscriptions";
import { paypalPlan, remoteSub, subId, subSnapshot } from "./paypal-subscription-fixtures";
import { addMonths } from "date-fns";

// Explicit opt-in. Never connect to the application/production DATABASE_URL.
const url = process.env.PAYPAL_TEST_DATABASE_URL;
describe.skipIf(!url)("PayPal PostgreSQL settlement", () => {
  const testSchema = `paypal_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof postgres>;
  let client: ReturnType<typeof postgres>;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    vi.stubEnv("PAYPAL_ENABLED", "true"); vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_ID", "client"); vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_MERCHANT_ID", "merchant"); vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH");
    vi.stubEnv("PAYPAL_SUBSCRIPTIONS_ENABLED", "true"); vi.stubEnv("PAYPAL_PLAN_STARTER_YEARLY", "P-YEAR");
    admin = postgres(url!, { max: 1, prepare: false, onnotice: () => {} });
    await admin.unsafe(`CREATE SCHEMA "${testSchema}"`);
    client = postgres(url!, { max: 5, prepare: false, onnotice: () => {}, connection: { search_path: testSchema } });
    database = drizzle(client, { schema });
    holder.database = database;
    const migrationDir = path.join(process.cwd(), "drizzle");
    for (const name of readdirSync(migrationDir).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = readFileSync(path.join(migrationDir, name), "utf8").replaceAll('"public".', `"${testSchema}".`);
      for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) await client.unsafe(statement);
    }
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (client) await client.end();
    if (admin) {
      // Only the random schema created above may be removed.
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    api.ids = []; api.plan.mockReset(); api.create.mockReset(); api.remote.mockReset();
    api.plan.mockResolvedValue(paypalPlan);
    api.create.mockImplementation(async (id: string) => {
      api.ids.push(id);
      return { id: `I-${id}`, links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/approve?id=${id}` }] };
    });
    api.remote.mockImplementation(async (id: string) => ({ ...remoteSub, id, custom_id: id.slice(2),
      status: "APPROVAL_PENDING", status_update_time: new Date().toISOString() }));
    await client.unsafe('TRUNCATE TABLE "user" CASCADE');
    await database.insert(user).values({ id: "buyer", name: "Buyer", email: "buyer@example.test", credits: 300 });
    await database.insert(billingOrder).values(localOrder);
  });

  it("grants exactly once under concurrent capture and webhook delivery", async () => {
    await Promise.all(Array.from({ length: 10 }, () => settlePayPalCapture(localOrder.id, remoteOrder, capture)));
    expect((await database.select().from(payment))).toHaveLength(1);
    const ledger = await database.select().from(creditLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(200);
    expect((await database.select().from(user))[0].credits).toBe(500);
    expect((await database.select().from(billingOrder))[0]).toMatchObject({ status: "succeeded", paymentId: "paypal:CAPTURE" });
  });

  it("rolls back payment and balance when the ledger write fails, then recovers on retry", async () => {
    await client.unsafe(`CREATE FUNCTION reject_paypal_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END; $$`);
    await client.unsafe('CREATE TRIGGER reject_paypal_ledger BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_paypal_ledger()');
    try {
      await expect(settlePayPalCapture(localOrder.id, remoteOrder, capture)).rejects.toThrow();
      expect(await database.select().from(payment)).toHaveLength(0);
      expect((await database.select().from(user))[0].credits).toBe(300);
      expect((await database.select().from(billingOrder))[0].status).toBe("created");
    } finally {
      await client.unsafe('DROP TRIGGER reject_paypal_ledger ON credit_ledger');
      await client.unsafe('DROP FUNCTION reject_paypal_ledger()');
    }
    await settlePayPalCapture(localOrder.id, remoteOrder, capture);
    expect((await database.select().from(user))[0].credits).toBe(500);
  });

  it("uses the purchased snapshot after the catalog changes and leaves the plan alone", async () => {
    await database.update(billingOrder).set({ credits: 275 }).where(eq(billingOrder.id, localOrder.id));
    await settlePayPalCapture(localOrder.id, remoteOrder, capture);
    expect((await database.select().from(user))[0]).toMatchObject({ credits: 575, planKey: "free" });
  });

  it("does not write any accounting record for mismatched or pending captures", async () => {
    await expect(settlePayPalCapture(localOrder.id, remoteOrder, { ...capture, status: "PENDING" })).rejects.toThrow();
    await expect(settlePayPalCapture(localOrder.id, remoteOrder, { ...capture, amount: { value: "0.01", currency_code: "USD" } })).rejects.toThrow();
    expect(await database.select().from(payment)).toHaveLength(0);
    expect(await database.select().from(creditLedger)).toHaveLength(0);
    expect((await database.select().from(user))[0].credits).toBe(300);
  });

  async function createAnnualSubscription() {
    const [created] = await database.insert(subscription).values({ id: subId, provider: "paypal", providerSubId: remoteSub.id,
      userId: "buyer", planKey: "starter_yearly", status: "active", billingSnapshot: JSON.stringify(subSnapshot),
      createdAt: new Date(Date.now() - 800 * 86_400_000) }).returning();
    return created;
  }
  function receipt(id: string, time = new Date(Date.now() - 86_400_000)) {
    return { id, status: "COMPLETED", time: time.toISOString(), amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "290.00" } } };
  }
  it("settles a subscription payment once under concurrent return and webhook delivery", async () => {
    await createAnnualSubscription();
    const paid = receipt("RENEWAL");
    await Promise.all(Array.from({ length: 8 }, () => settlePayPalSubscriptionPayment(subId, remoteSub, paid)));
    expect(await database.select().from(payment)).toHaveLength(1);
    expect(await database.select().from(subscriptionCreditGrant)).toHaveLength(12);
    expect((await database.select().from(user))[0]).toMatchObject({ credits: 1300, planKey: "starter_yearly" });
    expect(await database.select().from(creditLedger)).toHaveLength(1);
  });
  it("rolls back the entire subscription cycle when its ledger insert fails", async () => {
    await createAnnualSubscription();
    await client.unsafe(`CREATE FUNCTION reject_sub_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced subscription test failure'; END; $$`);
    await client.unsafe('CREATE TRIGGER reject_sub_ledger BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_sub_ledger()');
    try {
      await expect(settlePayPalSubscriptionPayment(subId, remoteSub, receipt("ROLLBACK"))).rejects.toThrow();
      expect(await database.select().from(payment)).toHaveLength(0);
      expect(await database.select().from(subscriptionCreditGrant)).toHaveLength(0);
      expect((await database.select().from(user))[0]).toMatchObject({ credits: 300, planKey: "free" });
      expect((await database.select().from(subscription))[0].currentPeriodEnd).toBeNull();
    } finally {
      await client.unsafe('DROP TRIGGER reject_sub_ledger ON credit_ledger');
      await client.unsafe('DROP FUNCTION reject_sub_ledger()');
    }
    await settlePayPalSubscriptionPayment(subId, remoteSub, receipt("ROLLBACK"));
    expect((await database.select().from(user))[0].credits).toBe(1300);
  });
  it("preserves both paid years when an older payment arrives after renewal", async () => {
    await createAnnualSubscription();
    const newest = receipt("NEW");
    await settlePayPalSubscriptionPayment(subId, remoteSub, newest);
    const paidThrough = (await database.select().from(subscription))[0].currentPeriodEnd;
    await settlePayPalSubscriptionPayment(subId, remoteSub, receipt("OLD", addMonths(new Date(newest.time), -12)));
    expect(await database.select().from(subscriptionCreditGrant)).toHaveLength(24);
    expect((await database.select().from(subscription))[0].currentPeriodEnd).toEqual(paidThrough);
    expect((await database.select().from(user))[0].credits).toBe(13300);
  });
  it("retains paid access and due installments after cancellation, without double cron grants", async () => {
    const local = await createAnnualSubscription();
    await settlePayPalSubscriptionPayment(subId, remoteSub, receipt("CANCEL"));
    await applyPayPalSubscriptionState(local, { ...remoteSub, status: "CANCELLED", status_update_time: new Date().toISOString() });
    expect((await database.select().from(user))[0].planKey).toBe("starter_yearly");
    const grants = await database.select().from(subscriptionCreditGrant);
    await database.update(subscriptionCreditGrant).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(subscriptionCreditGrant.id, grants.find(grant => !grant.grantedAt)!.id));
    await Promise.all([processDuePayPalGrants(), processDuePayPalGrants()]);
    expect((await database.select().from(user))[0].credits).toBe(2300);
    expect((await database.select().from(payment))[0].creditsGranted).toBe(2000);
  });
  it("does not regress canceled state on a same-time activation or grant a reviewed subscription", async () => {
    const local = await createAnnualSubscription();
    const stamp = new Date().toISOString();
    await applyPayPalSubscriptionState(local, { ...remoteSub, status: "CANCELLED", status_update_time: stamp });
    await applyPayPalSubscriptionState(local, { ...remoteSub, status: "ACTIVE", status_update_time: stamp });
    expect((await database.select().from(subscription))[0].status).toBe("canceled");
    await database.update(subscription).set({ billingReview: true }).where(eq(subscription.id, subId));
    await expect(settlePayPalSubscriptionPayment(subId, remoteSub, receipt("REVIEW"))).rejects.toThrow("SUBSCRIPTION_REQUIRES_REVIEW");
    expect(await database.select().from(payment)).toHaveLength(0);
  });
  it("resumes concurrent identical subscription requests without two local subscriptions", async () => {
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => startPayPalSubscription("buyer", "starter_yearly", requestId, "en")));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(new Set(api.ids).size).toBe(1);
    expect(await database.select().from(subscription)).toHaveLength(1);
    expect((await database.select().from(user))[0]).toMatchObject({ credits: 300, planKey: "free" });
  });
  it("serializes different checkout requests for the same user", async () => {
    const results = await Promise.allSettled([
      startPayPalSubscription("buyer", "starter_yearly", randomUUID(), "en"),
      startPayPalSubscription("buyer", "starter_yearly", randomUUID(), "en"),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await database.select().from(subscription)).toHaveLength(1);
  });
  it("retries an uncertain subscription creation with the same local reference", async () => {
    const requestId = randomUUID();
    api.create.mockImplementationOnce(async (id: string) => { api.ids.push(id); throw new Error("response lost"); });
    await expect(startPayPalSubscription("buyer", "starter_yearly", requestId, "en")).rejects.toThrow("response lost");
    await startPayPalSubscription("buyer", "starter_yearly", requestId, "en");
    expect(new Set(api.ids).size).toBe(1);
    expect(await database.select().from(subscription)).toHaveLength(1);
  });
  it("expires a stale plan label without removing earned credits", async () => {
    await createAnnualSubscription();
    await settlePayPalSubscriptionPayment(subId, remoteSub, receipt("EXPIRED", new Date(Date.now() - 730 * 86_400_000)));
    await database.update(user).set({ planKey: "starter_yearly" }).where(eq(user.id, "buyer"));
    await processDuePayPalGrants();
    expect((await database.select().from(user))[0]).toMatchObject({ credits: 12300, planKey: "free" });
  });
});
