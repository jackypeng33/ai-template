import { addUtcMonths, buildPaidSubscriptionCycle, shouldApplyProviderState, subscriptionTransactionWindow, validatePayPalPlan, validateSubscriptionReference } from "@/lib/payments/paypal-subscription-validation";
import { paypalPlan, remoteSub, subId, subReceipt, subSnapshot } from "./paypal-subscription-fixtures";

describe("PayPal subscription invariants", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-06-01T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });
  it("accepts only the configured recurring price and frequency", () => {
    expect(() => validatePayPalPlan(subSnapshot, paypalPlan)).not.toThrow();
    for (const patch of [
      { id: "P-OTHER" }, { status: "INACTIVE" }, { quantity_supported: true },
      { billing_cycles: [...paypalPlan.billing_cycles, paypalPlan.billing_cycles[0]] },
      { billing_cycles: [{ ...paypalPlan.billing_cycles[0], total_cycles: 12 }] },
      { billing_cycles: [{ ...paypalPlan.billing_cycles[0], frequency: { interval_unit: "MONTH", interval_count: 1 } }] },
      { taxes: { percentage: "10" } },
      { payment_preferences: { auto_bill_outstanding: true } },
      { payment_preferences: { auto_bill_outstanding: false, setup_fee: { currency_code: "USD", value: "1.00" } } },
    ]) expect(() => validatePayPalPlan(subSnapshot, { ...paypalPlan, ...patch })).toThrow("PAYPAL_PLAN_MISMATCH");
  });
  it("binds the subscription to the stored reference and rejects plan or quantity overrides", () => {
    expect(() => validateSubscriptionReference(subId, "pending:local", subSnapshot, remoteSub)).not.toThrow();
    for (const patch of [{ custom_id: "other" }, { id: "I-OTHER" }, { plan_id: "P-OTHER" }, { quantity: "2" }, { plan_overridden: true }]) {
      expect(() => validateSubscriptionReference(subId, "I-SUB", subSnapshot, { ...remoteSub, ...patch })).toThrow();
    }
  });
  it("creates twelve exact annual installments anchored to the paid transaction", () => {
    expect(addUtcMonths(new Date("2026-01-31T23:30:00Z"), 1).toISOString()).toBe("2026-02-28T23:30:00.000Z");
    const cycle = buildPaidSubscriptionCycle(subSnapshot, subReceipt);
    expect(cycle.grants).toHaveLength(12);
    expect(cycle.grants.reduce((sum, grant) => sum + grant.amount, 0)).toBe(12000);
    expect(cycle.grants[1].dueAt.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(cycle.grants[2].dueAt.toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(cycle.paidThrough.toISOString()).toBe("2027-01-31T12:00:00.000Z");
  });
  it("grants a monthly plan once per payment and handles a final rounding remainder", () => {
    const monthly = { ...subSnapshot, cycleMonths: 1 as const, grants: 1, amountCents: 2900, credits: 1000, creditsPerGrant: 1000 };
    const receipt = { ...subReceipt, amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "29" } } };
    expect(buildPaidSubscriptionCycle(monthly, receipt).grants).toHaveLength(1);
    const rounded = buildPaidSubscriptionCycle({ ...subSnapshot, credits: 12001 }, subReceipt);
    expect(rounded.grants.at(-1)?.amount).toBe(1001);
  });
  it.each(["PENDING", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"])("does not grant for %s payment", status => {
    expect(() => buildPaidSubscriptionCycle(subSnapshot, { ...subReceipt, status })).toThrow();
  });
  it("rejects wrong price, currency and future payment time", () => {
    for (const receipt of [
      { ...subReceipt, amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "29.00" } } },
      { ...subReceipt, amount_with_breakdown: { gross_amount: { currency_code: "EUR", value: "290.00" } } },
      { ...subReceipt, time: "2028-01-01T00:00:00Z" },
    ]) expect(() => buildPaidSubscriptionCycle(subSnapshot, receipt)).toThrow();
  });
  it("bounds catch-up searches and overlaps the previous day to recover delayed receipts", () => {
    const first = subscriptionTransactionWindow(new Date("2026-01-01T00:00:00Z"), null);
    expect(first.end.getTime() - first.start.getTime()).toBe(30 * 86_400_000);
    const second = subscriptionTransactionWindow(new Date("2026-01-01T00:00:00Z"), first.end);
    expect(second.start.getTime()).toBe(first.end.getTime() - 86_400_000);
    expect(second.end > first.end).toBe(true);
  });
  it("does not regress provider state on old or same-time activation events", () => {
    expect(shouldApplyProviderState({ status: "canceled", providerUpdatedAt: new Date(remoteSub.status_update_time) }, remoteSub)).toBe(false);
    expect(shouldApplyProviderState({ status: "active", providerUpdatedAt: new Date("2026-02-01T00:00:00Z") }, remoteSub)).toBe(false);
    expect(shouldApplyProviderState({ status: "active", providerUpdatedAt: null }, remoteSub)).toBe(true);
  });
});
