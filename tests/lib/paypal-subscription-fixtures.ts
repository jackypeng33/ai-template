import type { PayPalPlan, PayPalSubscription, PayPalSubscriptionTransaction } from "@/lib/payments/paypal-subscription-api";
import type { SubscriptionSnapshot } from "@/lib/payments/paypal-subscription-validation";
export const subId = "00000000-0000-4000-8000-000000000002";
export const subSnapshot: SubscriptionSnapshot = {
  planId: "P-YEAR", merchantId: "merchant", environment: "sandbox", amountCents: 29000,
  currency: "usd", credits: 12000, cycleMonths: 12, grants: 12, creditsPerGrant: 1000,
};
export const paypalPlan: PayPalPlan = {
  id: "P-YEAR", status: "ACTIVE", quantity_supported: false,
  billing_cycles: [{ tenure_type: "REGULAR", sequence: 1, total_cycles: 0,
    frequency: { interval_unit: "YEAR", interval_count: 1 }, pricing_scheme: { fixed_price: { currency_code: "USD", value: "290.00" } } }],
  payment_preferences: { auto_bill_outstanding: false, setup_fee: { currency_code: "USD", value: "0.00" } },
};
export const remoteSub: PayPalSubscription = {
  id: "I-SUB", plan_id: "P-YEAR", custom_id: subId, status: "ACTIVE", quantity: "1",
  status_update_time: "2026-01-01T00:00:00Z", plan_overridden: false,
};
export const subReceipt: PayPalSubscriptionTransaction = {
  id: "SALE-ONE", status: "COMPLETED", time: "2026-01-31T12:00:00Z",
  amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "290.00" } },
};
