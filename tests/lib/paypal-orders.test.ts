import { localOrder, remoteOrder, capture } from "./paypal-fixtures";
const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][], remote: vi.fn(), capture: vi.fn(), captureDetails: vi.fn(), settle: vi.fn(), update: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows.shift() ?? [] }) }) }),
  update: () => ({ set: (value: unknown) => ({ where: async () => mocks.update(value) }) }),
} }));
vi.mock("@/lib/payments/settlement", () => ({ settlePayPalCapture: mocks.settle }));
vi.mock("@/lib/payments/paypal", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/paypal")>(),
  getPayPalConfig: () => ({ environment: "sandbox", merchantId: "merchant" }),
  getPayPalOrder: mocks.remote, capturePayPalOrder: mocks.capture, getPayPalCapture: mocks.captureDetails,
}));
import { completePayPalOrder, getOwnedPayPalOrder, startPayPalCheckout } from "@/lib/payments/paypal-orders";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [[localOrder]];
  mocks.captureDetails.mockResolvedValue(capture);
  mocks.settle.mockResolvedValue({ ...localOrder, status: "succeeded" });
});
describe("PayPal capture recovery", () => {
  it.each(["toString", "starter_monthly", "unknown"])("rejects non-pack key %s before order creation", async key => {
    await expect(startPayPalCheckout("buyer", key, "request", "en")).rejects.toThrow("INVALID_PACK");
  });
  it("does not charge an order not owned by the user", async () => {
    mocks.rows = [[]];
    await expect(getOwnedPayPalOrder(localOrder.id, "other-user")).rejects.toThrow("ORDER_NOT_FOUND");
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("returns an already settled order without contacting PayPal", async () => {
    mocks.rows = [[{ ...localOrder, status: "succeeded" }]];
    expect((await completePayPalOrder(localOrder.id)).status).toBe("succeeded");
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it("resolves a lost capture response by reading the original order", async () => {
    mocks.remote.mockResolvedValueOnce({ ...remoteOrder, status: "APPROVED" }).mockResolvedValueOnce(remoteOrder);
    mocks.capture.mockRejectedValue(new Error("response lost"));
    expect((await completePayPalOrder(localOrder.id)).status).toBe("succeeded");
    expect(mocks.capture).toHaveBeenCalledWith("REMOTE", localOrder.id);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
  });
  it("leaves pending funding without a credit grant", async () => {
    mocks.remote.mockResolvedValue(remoteOrder);
    mocks.captureDetails.mockResolvedValue({ ...capture, status: "PENDING" });
    expect((await completePayPalOrder(localOrder.id)).status).toBe("pending");
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("handles a minimal successful capture response by fetching the full order", async () => {
    mocks.remote.mockResolvedValueOnce({ ...remoteOrder, status: "APPROVED" }).mockResolvedValue(remoteOrder);
    mocks.capture.mockResolvedValue({ id: "REMOTE", status: "COMPLETED" });
    expect((await completePayPalOrder(localOrder.id)).status).toBe("succeeded");
    expect(mocks.settle).toHaveBeenCalledWith(localOrder.id, remoteOrder, capture);
  });
  it("checks the receiving merchant before capturing", async () => {
    mocks.remote.mockResolvedValue({ ...remoteOrder, status: "APPROVED", purchase_units: [{ ...remoteOrder.purchase_units[0], payee: { merchant_id: "other" } }] });
    await expect(completePayPalOrder(localOrder.id)).rejects.toThrow("PAYPAL_ORDER_MISMATCH");
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
