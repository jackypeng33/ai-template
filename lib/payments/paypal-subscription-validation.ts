import { z } from "zod";
import { isSubscriptionKey, subscriptionPlans, type PlanKey } from "@/constants/billing";
import { amountToCents } from "./paypal-validation";
import { getPayPalConfig, PayPalError } from "./paypal";
import type { PayPalPlan, PayPalSubscription, PayPalSubscriptionTransaction } from "./paypal-subscription-api";

export const subscriptionSnapshotSchema = z.object({
  planId: z.string(), merchantId: z.string(), environment: z.enum(["sandbox", "live"]),
  amountCents: z.number().int().positive(), currency: z.literal("usd"),
  credits: z.number().int().positive(), cycleMonths: z.union([z.literal(1), z.literal(12)]),
  grants: z.number().int().positive(), creditsPerGrant: z.number().int().positive(),
});
export type SubscriptionSnapshot = z.infer<typeof subscriptionSnapshotSchema>;
export function addUtcMonths(date: Date, months: number) {
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}
export function createSubscriptionSnapshot(key: PlanKey, planId: string): SubscriptionSnapshot {
  const plan = subscriptionPlans[key];
  const config = getPayPalConfig();
  const grants = plan.cycle === "year" ? 12 : 1;
  return { planId, merchantId: config.merchantId, environment: config.environment,
    amountCents: plan.priceCents, currency: plan.currency, credits: plan.creditsPerCycle,
    cycleMonths: plan.cycle === "year" ? 12 : 1, grants, creditsPerGrant: Math.floor(plan.creditsPerCycle / grants) };
}
export function readSubscriptionSnapshot(raw: string | null, key: string) {
  if (!raw || !isSubscriptionKey(key) || !Object.hasOwn(subscriptionPlans, key)) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
  return subscriptionSnapshotSchema.parse(JSON.parse(raw));
}
export function validatePayPalPlan(snapshot: SubscriptionSnapshot, plan: PayPalPlan) {
  const cycle = plan.billing_cycles[0];
  if (plan.id !== snapshot.planId || plan.status !== "ACTIVE" || plan.billing_cycles.length !== 1 || !cycle ||
      cycle.tenure_type !== "REGULAR" || cycle.sequence !== 1 || cycle.total_cycles !== 0 ||
      cycle.frequency.interval_count !== 1 || cycle.frequency.interval_unit !== (snapshot.cycleMonths === 12 ? "YEAR" : "MONTH") ||
      cycle.pricing_scheme.fixed_price.currency_code !== "USD" ||
      amountToCents(cycle.pricing_scheme.fixed_price.value) !== snapshot.amountCents ||
      plan.quantity_supported === true || plan.payment_preferences.auto_bill_outstanding ||
      (plan.payment_preferences.setup_fee && amountToCents(plan.payment_preferences.setup_fee.value) !== 0) ||
      (plan.taxes && Number(plan.taxes.percentage) !== 0)) {
    throw new PayPalError(409, "PAYPAL_PLAN_MISMATCH");
  }
}
export function validateSubscriptionReference(localId: string, providerSubId: string, snapshot: SubscriptionSnapshot, remote: PayPalSubscription) {
  if (remote.custom_id !== localId || remote.plan_id !== snapshot.planId || remote.plan_overridden === true ||
      remote.quantity !== "1" || (!providerSubId.startsWith("pending:") && remote.id !== providerSubId) ||
      (remote.shipping_amount && amountToCents(remote.shipping_amount.value) !== 0)) {
    throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_MISMATCH");
  }
}
export function buildPaidSubscriptionCycle(snapshot: SubscriptionSnapshot, receipt: PayPalSubscriptionTransaction) {
  if (receipt.status !== "COMPLETED" || receipt.amount_with_breakdown.gross_amount.currency_code !== "USD" ||
      amountToCents(receipt.amount_with_breakdown.gross_amount.value) !== snapshot.amountCents) {
    throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_PAYMENT_MISMATCH");
  }
  const paidAt = new Date(receipt.time);
  if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_PAYMENT_MISMATCH");
  const grants = Array.from({ length: snapshot.grants }, (_, index) => ({
    index, dueAt: addUtcMonths(paidAt, index),
    amount: index === snapshot.grants - 1 ? snapshot.credits - snapshot.creditsPerGrant * index : snapshot.creditsPerGrant,
  }));
  return { paidAt, paidThrough: addUtcMonths(paidAt, snapshot.cycleMonths), grants };
}

export function subscriptionTransactionWindow(createdAt: Date, checkedThrough: Date | null, now = new Date()) {
  const cursor = checkedThrough || createdAt;
  const start = new Date(Math.max(createdAt.getTime() - 3600_000, cursor.getTime() - 86_400_000));
  const end = new Date(Math.min(now.getTime(), start.getTime() + 30 * 86_400_000));
  if (start > end) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
  return { start, end };
}
export function shouldApplyProviderState(current: { providerUpdatedAt: Date | null; status: string }, remote: PayPalSubscription) {
  const stamp = new Date(remote.status_update_time);
  return !current.providerUpdatedAt || !(current.providerUpdatedAt > stamp ||
    (current.providerUpdatedAt.getTime() === stamp.getTime() && ["canceled", "expired"].includes(current.status)));
}
