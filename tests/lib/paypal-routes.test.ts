// @vitest-environment node
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), checkout: vi.fn(), owned: vi.fn(), complete: vi.fn(), verify: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getActiveSessionUser: mocks.session }));
vi.mock("@/lib/payments/paypal-orders", () => ({
  startPayPalCheckout: mocks.checkout, getOwnedPayPalOrder: mocks.owned, completePayPalOrder: mocks.complete,
  publicPayPalOrder: (order: unknown) => order,
}));
vi.mock("@/lib/payments/paypal-webhook", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/paypal-webhook")>(), processPayPalWebhook: mocks.process,
}));
vi.mock("@/lib/payments/paypal", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/paypal")>(), verifyPayPalWebhook: mocks.verify,
}));
import { POST as checkout } from "@/app/api/payments/paypal/checkout/route";
import { POST as captureRoute } from "@/app/api/payments/paypal/capture/route";
import { GET as statusRoute } from "@/app/api/payments/paypal/orders/[orderId]/route";
import { POST as webhook } from "@/app/api/payments/paypal/webhook/route";
import { PayPalError } from "@/lib/payments/paypal";
import { orderId } from "./paypal-fixtures";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ ok: true, user: { id: "buyer" } });
});
function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, { method: "POST", body: JSON.stringify(body) });
}
describe("PayPal HTTP access boundaries", () => {
  it("blocks anonymous checkout", async () => {
    mocks.session.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await checkout(request("/checkout", {}))).status).toBe(401);
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("rejects client-defined identity, amount or subscription fields", async () => {
    for (const extra of [{ userId: "victim" }, { amount: "0.01" }, { kind: "subscription" }]) {
      expect((await checkout(request("/checkout", { key: "pack_200", locale: "en", requestId: orderId, ...extra }))).status).toBe(400);
    }
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it("uses only the session user for checkout", async () => {
    mocks.checkout.mockResolvedValue({ url: "https://www.sandbox.paypal.com/", orderId });
    expect((await checkout(request("/checkout", { key: "pack_200", locale: "zh", requestId: orderId }))).status).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledWith("buyer", "pack_200", orderId, "zh");
  });
  it("cannot capture or view another user's order", async () => {
    mocks.owned.mockRejectedValue(new PayPalError(404, "ORDER_NOT_FOUND"));
    expect((await captureRoute(request("/capture", { orderId }))).status).toBe(404);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect((await statusRoute(new NextRequest("http://localhost:3000/status"), { params: Promise.resolve({ orderId }) })).status).toBe(404);
    expect(mocks.owned).toHaveBeenCalledWith(orderId, "buyer");
  });
  it("rejects forged webhooks before database processing", async () => {
    mocks.verify.mockResolvedValue(false);
    expect((await webhook(request("/webhook", { id: "WH", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C" } }))).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it("requests a retry when verified processing fails", async () => {
    mocks.verify.mockResolvedValue(true);
    mocks.process.mockRejectedValue(new Error("database unavailable"));
    expect((await webhook(request("/webhook", { id: "WH", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "C" } }))).status).toBe(502);
  });
});
