import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { subscription } from "@/lib/db/schema";

// Cancellation stops renewal, not an already paid entitlement. Approval alone
// never grants a PayPal plan. Creem keeps its existing active-state behavior.
export function paidSubscription(now = new Date()) {
  return or(
    and(eq(subscription.provider, "paypal"), eq(subscription.billingReview, false), gt(subscription.currentPeriodEnd, now)),
    and(ne(subscription.provider, "paypal"), eq(subscription.status, "active"),
      or(isNull(subscription.currentPeriodEnd), gt(subscription.currentPeriodEnd, now))),
  );
}
export function entitledSubscription(userId: string, now = new Date()) {
  return and(eq(subscription.userId, userId), paidSubscription(now));
}
