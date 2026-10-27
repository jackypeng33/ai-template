// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), checkout: vi.fn(), verify: vi.fn(), webhook: vi.fn(), jobs: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/session", () => ({ getActiveSessionUser: mocks.access }));
vi.mock("@/lib/rap/payments", () => ({ startRapCheckout: mocks.checkout, processRapWebhook: mocks.webhook }));
vi.mock("@/lib/rap/worker", () => ({ processRapJobs: mocks.jobs, reconcileRapOrders: vi.fn(), sendRapNotifications: vi.fn(), cleanupRapMedia: vi.fn() }));
vi.mock("@/lib/payments/paypal", async original => ({ ...await original<typeof import("@/lib/payments/paypal")>(), verifyPayPalWebhook: mocks.verify }));
import { POST as checkout } from "@/app/api/rap/orders/route";
import { POST as webhook } from "@/app/api/rap/paypal/webhook/route";
import { GET as cron } from "@/app/api/cron/rap-video/route";
import { GET as manage } from "@/app/api/rap/manage/route";
import { RAP_PRODUCT } from "@/lib/rap/config";

const request = (body: unknown) => new Request("http://localhost:3000/api/rap/orders", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body) });
describe("BOOTH HTTP permission and payment boundaries", () => {
  beforeEach(() => { vi.unstubAllEnvs(); mocks.access.mockReset(); mocks.verify.mockReset(); mocks.checkout.mockReset(); mocks.webhook.mockReset(); mocks.jobs.mockReset(); });
  it("rejects anonymous checkout before reaching the payment provider", async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
    expect((await checkout(request({}))).status).toBe(401); expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("rejects a tampered price before payment creation", async () => {
    mocks.access.mockResolvedValue({ ok: true, user: { id: "buyer", role: "user" } });
    const response = await checkout(request({ requestId: crypto.randomUUID(), leftAssetId: crypto.randomUUID(), rightAssetId: crypto.randomUUID(), productKey: RAP_PRODUCT.key, priceCents: 1 }));
    expect(response.status).toBe(400); expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("requires the dedicated Rap webhook ID and an authenticated signature", async () => {
    expect((await webhook(request({}))).status).toBe(503); expect(mocks.verify).not.toHaveBeenCalled();
    vi.stubEnv("RAP_PAYPAL_WEBHOOK_ID", "WH-RAP"); mocks.verify.mockResolvedValue(false);
    expect((await webhook(request({}))).status).toBe(401); expect(mocks.webhook).not.toHaveBeenCalled();
    expect(mocks.verify.mock.calls[0][2]).toBe("WH-RAP");
  });
  it("does not run background work without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "local-test-secret");
    expect((await cron(new Request("http://localhost:3000/api/cron/rap-video"))).status).toBe(401);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
  it("does not expose customer orders and feedback to an ordinary user", async () => {
    mocks.access.mockResolvedValue({ ok: true, user: { id: "buyer", role: "user" } });
    expect((await manage(new Request("http://localhost:3000/api/rap/manage"))).status).toBe(403);
  });
});
