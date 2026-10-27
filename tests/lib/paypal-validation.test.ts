import { amountToCents, validatePayPalCapture, validatePayPalOrder } from "@/lib/payments/paypal-validation";
import { capture, localOrder, remoteOrder } from "./paypal-fixtures";

describe("PayPal fulfillment validation", () => {
  it("accepts a completed capture bound to the exact order and merchant", () => {
    expect(() => validatePayPalCapture(localOrder, remoteOrder, capture)).not.toThrow();
    expect(amountToCents("0.29")).toBe(29);
    expect(amountToCents("5")).toBe(500);
    expect(amountToCents("5.0")).toBe(500);
  });
  it.each(["-5.00", "5e0", "5.001", "NaN", "900719925474099.00"])("rejects invalid money %s", value => {
    expect(() => amountToCents(value)).toThrow();
  });
  it.each(["PENDING", "DECLINED", "REFUNDED", "PARTIALLY_REFUNDED"])("does not fulfill %s funding", status => {
    expect(() => validatePayPalCapture(localOrder, remoteOrder, { ...capture, status })).toThrow();
  });
  it("rejects price, currency and recipient mismatches", () => {
    for (const patch of [
      { amount: { value: "4.99", currency_code: "USD" } },
      { amount: { value: "5.00", currency_code: "EUR" } },
      { payee: { merchant_id: "other" } },
    ]) expect(() => validatePayPalCapture(localOrder, remoteOrder, { ...capture, ...patch })).toThrow();
  });
  it("rejects swapped orders, references, multi-unit and multi-capture payments", () => {
    expect(() => validatePayPalOrder(localOrder, { ...remoteOrder, id: "OTHER" })).toThrow();
    expect(() => validatePayPalOrder(localOrder, { ...remoteOrder, purchase_units: [{ ...remoteOrder.purchase_units[0], custom_id: "other" }] })).toThrow();
    expect(() => validatePayPalOrder(localOrder, { ...remoteOrder, purchase_units: [...remoteOrder.purchase_units, ...remoteOrder.purchase_units] })).toThrow();
    expect(() => validatePayPalCapture(localOrder, remoteOrder, { ...capture, supplementary_data: { related_ids: { order_id: "OTHER" } } })).toThrow();
    expect(() => validatePayPalCapture(localOrder, {
      ...remoteOrder, purchase_units: [{ ...remoteOrder.purchase_units[0], payments: { captures: [capture, { ...capture, id: "SECOND" }] } }],
    }, capture)).toThrow();
  });
});
