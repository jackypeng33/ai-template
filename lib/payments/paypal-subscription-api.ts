import { z } from "zod";
import type { PlanKey } from "@/constants/billing";
import { getPayPalConfig, getPayPalReturnUrl, isPayPalEnabled, paypalRequest, PayPalError } from "./paypal";

export const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
export const paypalPlanSchema = z.object({
  id: z.string(), status: z.string(), quantity_supported: z.boolean().optional(),
  billing_cycles: z.array(z.object({
    tenure_type: z.string(), sequence: z.number(), total_cycles: z.number(),
    frequency: z.object({ interval_unit: z.string(), interval_count: z.number() }),
    pricing_scheme: z.object({ fixed_price: moneySchema }),
  })),
  payment_preferences: z.object({ auto_bill_outstanding: z.boolean(), setup_fee: moneySchema.optional() }),
  taxes: z.object({ percentage: z.string() }).optional(),
});
export const paypalSubscriptionSchema = z.object({
  id: z.string(), plan_id: z.string(), custom_id: z.string().optional(), status: z.string(),
  quantity: z.string().optional(), plan_overridden: z.boolean().optional(),
  status_update_time: z.string().datetime({ offset: true }),
  shipping_amount: moneySchema.optional(),
  billing_info: z.object({
    next_billing_time: z.string().datetime({ offset: true }).optional(),
    last_payment: z.object({ time: z.string().datetime({ offset: true }) }).optional(),
  }).optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
export const paypalSubscriptionTransactionSchema = z.object({
  id: z.string(), status: z.string(), time: z.string().datetime({ offset: true }),
  amount_with_breakdown: z.object({ gross_amount: moneySchema }),
});
export type PayPalSubscription = z.infer<typeof paypalSubscriptionSchema>;
export type PayPalPlan = z.infer<typeof paypalPlanSchema>;
export type PayPalSubscriptionTransaction = z.infer<typeof paypalSubscriptionTransactionSchema>;

const planVariables: Record<PlanKey, string> = {
  starter_monthly: "PAYPAL_PLAN_STARTER_MONTHLY", starter_yearly: "PAYPAL_PLAN_STARTER_YEARLY",
  pro_monthly: "PAYPAL_PLAN_PRO_MONTHLY", pro_yearly: "PAYPAL_PLAN_PRO_YEARLY",
};
export function payPalSubscriptionMode() { return process.env.PAYPAL_SUBSCRIPTIONS_ENABLED === "true"; }
export function configuredPayPalPlans() {
  return isPayPalEnabled() && payPalSubscriptionMode()
    ? Object.keys(planVariables).filter(key => Boolean(process.env[planVariables[key as PlanKey]]?.trim())) : [];
}
export function getPayPalPlanId(key: PlanKey) {
  getPayPalConfig();
  const id = process.env[planVariables[key]]?.trim();
  if (!payPalSubscriptionMode() || !id) throw new PayPalError(503, "PAYPAL_PLAN_NOT_CONFIGURED");
  return id;
}
export async function getPayPalPlan(id: string) {
  return paypalPlanSchema.parse(await paypalRequest(`/v1/billing/plans/${encodeURIComponent(id)}`));
}
export async function getPayPalSubscription(id: string) {
  return paypalSubscriptionSchema.parse(await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}`));
}
export function getSubscriptionReturnUrl(id: string, locale: string, cancelled = false) {
  const url = new URL(getPayPalReturnUrl(id, locale, cancelled));
  url.pathname = `${locale === "zh" ? "/zh" : ""}/billing/subscription-return`;
  url.searchParams.delete("orderId");
  url.searchParams.set("id", id);
  return url.toString();
}
export async function createPayPalSubscription(id: string, planId: string, locale: string) {
  return z.object({ id: z.string(), links: z.array(z.object({ rel: z.string(), href: z.string() })).optional() }).parse(
    await paypalRequest("/v1/billing/subscriptions", "POST", {
      plan_id: planId, custom_id: id, quantity: "1",
      application_context: {
        shipping_preference: "NO_SHIPPING", user_action: "SUBSCRIBE_NOW",
        return_url: getSubscriptionReturnUrl(id, locale), cancel_url: getSubscriptionReturnUrl(id, locale, true),
      },
    }, `subscribe-${id}`));
}
export async function cancelPayPalSubscription(id: string) {
  await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, "POST", { reason: "Customer requested cancellation of automatic renewal" });
}
export async function listPayPalSubscriptionTransactions(id: string, around: Date, until?: Date) {
  // A narrow window also supports replaying historical webhooks. PayPal limits
  // transaction searches to a date range; never search an unbounded history.
  const start = until ? around : new Date(around.getTime() - 86_400_000);
  const end = until || new Date(Math.min(Date.now(), around.getTime() + 86_400_000));
  const params = new URLSearchParams({ start_time: start.toISOString(), end_time: end.toISOString() });
  const result = await paypalRequest(`/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?${params}`);
  const parsed = z.object({ transactions: z.array(paypalSubscriptionTransactionSchema), total_pages: z.number().optional() }).parse(result);
  if ((parsed.total_pages ?? 1) > 1) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
  return parsed.transactions;
}
