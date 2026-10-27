const mocks = vi.hoisted(() => ({ get: vi.fn(), resolve: vi.fn(), sync: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/payments/paypal-subscription-api", () => ({ getPayPalSubscription: mocks.get }));
vi.mock("@/lib/payments/paypal-subscriptions", () => ({
  resolvePayPalSubscription: mocks.resolve, syncPayPalSubscription: mocks.sync, reviewPayPalSubscriptionSale: mocks.review,
}));
import { processPayPalSubscriptionEvent } from "@/lib/payments/paypal-subscription-events";
import { remoteSub, subId } from "./paypal-subscription-fixtures";
beforeEach(() => {
  vi.resetAllMocks(); mocks.get.mockResolvedValue(remoteSub); mocks.resolve.mockResolvedValue({ id: subId });
});
describe("PayPal subscription event dispatch", () => {
  it("uses fresh state when an old cancellation event arrives", async () => {
    await processPayPalSubscriptionEvent({ event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-SUB" } });
    expect(mocks.resolve).toHaveBeenCalledWith(remoteSub);
    expect(mocks.sync).toHaveBeenCalledWith(subId);
  });
  it("requires the exact completed sale in the authoritative subscription history", async () => {
    await processPayPalSubscriptionEvent({ event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "SALE", billing_agreement_id: "I-SUB", create_time: "2026-01-01T00:00:00Z" } });
    expect(mocks.sync).toHaveBeenCalledWith(subId, { id: "SALE", time: "2026-01-01T00:00:00Z" });
  });
  it("does not interpret activation or payment failure as proof of payment", async () => {
    await processPayPalSubscriptionEvent({ event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED", resource: { id: "I-SUB" } });
    expect(mocks.sync).toHaveBeenCalledWith(subId);
  });
  it("persists a review decision and pauses a refunded subscription", async () => {
    const result = await processPayPalSubscriptionEvent({ event_type: "PAYMENT.SALE.REFUNDED", resource: { id: "SALE", billing_agreement_id: "I-SUB" } });
    expect(result.status).toBe("requires_review");
    expect(mocks.review).toHaveBeenCalledWith("SALE", "I-SUB");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("ignores subscriptions belonging to another product on the same PayPal app", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await processPayPalSubscriptionEvent({ event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: { id: "I-OTHER" } })).status).toBe("ignored");
  });
  it("propagates a transient payment lookup failure for webhook retry", async () => {
    mocks.sync.mockRejectedValue(new Error("provider history not yet available"));
    await expect(processPayPalSubscriptionEvent({ event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "SALE", billing_agreement_id: "I-SUB", create_time: "2026-01-01T00:00:00Z" } })).rejects.toThrow();
  });
});
