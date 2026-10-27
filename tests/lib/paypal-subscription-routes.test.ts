// @vitest-environment node
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), start: vi.fn(), owned: vi.fn(), sync: vi.fn(), cancel: vi.fn(), managed: vi.fn(), creem: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getActiveSessionUser: mocks.session }));
vi.mock("@/lib/payments/paypal-subscriptions", () => ({
  startPayPalSubscription: mocks.start, getOwnedPayPalSubscription: mocks.owned,
  syncPayPalSubscription: mocks.sync, cancelOwnedPayPalSubscription: mocks.cancel,
  publicPayPalSubscription: (value: unknown) => value,
  hasManagedPayPalSubscription: mocks.managed,
}));
vi.mock("@/lib/payments/creem", () => ({ createCheckoutSession: mocks.creem }));
import { POST as create } from "@/app/api/payments/paypal/subscriptions/route";
import { POST as action } from "@/app/api/payments/paypal/subscriptions/[id]/route";
import { POST as creemCheckout } from "@/app/api/payments/creem/checkout/route";
import { PayPalError } from "@/lib/payments/paypal";
import { subId } from "./paypal-subscription-fixtures";
function req(body: unknown) { return new NextRequest("http://localhost:3000/api", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ ok: true, user: { id: "buyer" } }); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("PayPal subscription API permissions", () => {
  it("rejects anonymous subscription creation", async () => {
    mocks.session.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await create(req({}))).status).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not accept client price, plan ID or user identity", async () => {
    for (const extra of [{ userId: "victim" }, { price: 1 }, { planId: "P-CHEAP" }]) {
      expect((await create(req({ key: "starter_monthly", locale: "en", requestId: subId, ...extra }))).status).toBe(400);
    }
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("uses the authenticated identity and server catalog key", async () => {
    mocks.start.mockResolvedValue({ id: subId, url: "https://www.sandbox.paypal.com/" });
    expect((await create(req({ key: "starter_yearly", locale: "zh", requestId: subId }))).status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith("buyer", "starter_yearly", subId, "zh");
  });
  it.each(["sync", "cancel"])("checks ownership before %s", async method => {
    mocks.owned.mockRejectedValue(new PayPalError(404, "SUBSCRIPTION_NOT_FOUND"));
    expect((await action(req({ action: method }), { params: Promise.resolve({ id: subId }) })).status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("cancels only the logged-in user's subscription", async () => {
    mocks.owned.mockResolvedValue({ id: subId }); mocks.cancel.mockResolvedValue({ status: "canceled" });
    expect((await action(req({ action: "cancel" }), { params: Promise.resolve({ id: subId }) })).status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(subId, "buyer");
  });
  it("blocks new Creem subscriptions while PayPal mode is enabled", async () => {
    vi.stubEnv("PAYPAL_SUBSCRIPTIONS_ENABLED", "true");
    expect((await creemCheckout(req({ kind: "subscription", key: "starter_monthly" }))).status).toBe(409);
    expect(mocks.creem).not.toHaveBeenCalled();
  });
  it("also blocks cross-provider overlap after the new-checkout flag is disabled", async () => {
    vi.stubEnv("PAYPAL_SUBSCRIPTIONS_ENABLED", "false");
    mocks.managed.mockResolvedValue(true);
    expect((await creemCheckout(req({ kind: "subscription", key: "starter_monthly" }))).status).toBe(409);
    expect(mocks.creem).not.toHaveBeenCalled();
  });
});
