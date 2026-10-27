const state = vi.hoisted(() => ({
  event: null as null | { status: string; error?: string | null },
  resolve: vi.fn(), complete: vi.fn(), capture: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  insert: () => ({ values: (value: { status?: string }) => ({ onConflictDoNothing: () => ({ returning: async () => {
    if (state.event) return [];
    state.event = { ...value, status: "received" };
    return [state.event];
  } }) }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [state.event] }) }) }),
  update: () => ({ set: (value: { status: string; error?: string | null }) => ({ where: async () => { state.event = { ...state.event, ...value }; } }) }),
} }));
vi.mock("@/lib/payments/paypal-orders", () => ({ resolvePayPalNotificationOrder: state.resolve, completePayPalOrder: state.complete }));
vi.mock("@/lib/payments/paypal", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/paypal")>(), getPayPalCapture: state.capture,
}));
import { processPayPalWebhook } from "@/lib/payments/paypal-webhook";
const event = { id: "WH", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "REMOTE" } };
beforeEach(() => {
  vi.resetAllMocks(); state.event = null;
  state.resolve.mockResolvedValue({ id: "local" });
  state.complete.mockResolvedValue({ status: "succeeded" });
});
describe("PayPal event processing", () => {
  it("captures approved orders even if the buyer never opens the return page", async () => {
    await processPayPalWebhook(event);
    expect(state.complete).toHaveBeenCalledWith("local");
    expect(state.event?.status).toBe("processed");
    await processPayPalWebhook(event);
    expect(state.complete).toHaveBeenCalledTimes(1);
  });
  it("retains failed events and allows a replay to recover", async () => {
    state.complete.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(processPayPalWebhook(event)).rejects.toThrow();
    expect(state.event?.status).toBe("failed");
    await processPayPalWebhook(event);
    expect(state.event?.status).toBe("processed");
    expect(state.complete).toHaveBeenCalledTimes(2);
  });
  it("gets the authoritative capture order and retries if funding is not yet settled", async () => {
    state.capture.mockResolvedValue({ supplementary_data: { related_ids: { order_id: "REMOTE" } } });
    state.complete.mockResolvedValueOnce({ status: "pending" });
    const completed = { ...event, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAPTURE" } };
    await expect(processPayPalWebhook(completed)).rejects.toThrow("PAYPAL_PAYMENT_NOT_SETTLED");
    expect(state.resolve).toHaveBeenCalledWith("REMOTE");
    expect(state.event?.status).toBe("failed");
    await processPayPalWebhook(completed);
    expect(state.event?.status).toBe("processed");
  });
  it.each(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"])("persists %s for manual review", async event_type => {
    await processPayPalWebhook({ ...event, event_type });
    expect(state.event?.status).toBe("requires_review");
    expect(state.complete).not.toHaveBeenCalled();
  });
});
