import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, payment, paymentEvent, subscription, subscriptionCreditGrant, user } from "@/lib/db/schema";
import { isSubscriptionKey, subscriptionPlans } from "@/constants/billing";
import { entitledSubscription, paidSubscription } from "@/lib/billing/entitlement";
import { getPayPalConfig, isPayPalEnabled, PayPalError } from "./paypal";
import {
  cancelPayPalSubscription, createPayPalSubscription, getPayPalPlan, getPayPalPlanId,
  getPayPalSubscription, getSubscriptionReturnUrl, listPayPalSubscriptionTransactions,
  type PayPalSubscription, type PayPalSubscriptionTransaction,
} from "./paypal-subscription-api";
import {
  buildPaidSubscriptionCycle, createSubscriptionSnapshot, readSubscriptionSnapshot,
  validatePayPalPlan, validateSubscriptionReference,
  shouldApplyProviderState, subscriptionTransactionWindow,
} from "./paypal-subscription-validation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type LocalSubscription = typeof subscription.$inferSelect;
const openStates = ["approval_pending", "approved", "active", "suspended", "needs_review"];
async function lockUser(tx: Tx, userId: string) {
  const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
  if (!found) throw new PayPalError(404, "SUBSCRIPTION_NOT_FOUND");
}
async function refreshPlan(tx: Tx, userId: string, now = new Date()) {
  const [entitlement] = await tx.select({ key: subscription.planKey }).from(subscription)
    .where(entitledSubscription(userId, now)).orderBy(desc(subscription.currentPeriodEnd)).limit(1);
  await tx.update(user).set({ planKey: entitlement?.key ?? "free" }).where(eq(user.id, userId));
}
function snapshotFor(local: LocalSubscription) {
  const snapshot = readSubscriptionSnapshot(local.billingSnapshot, local.planKey);
  const config = getPayPalConfig();
  if (snapshot.environment !== config.environment || snapshot.merchantId !== config.merchantId) {
    throw new PayPalError(409, "PAYPAL_ENVIRONMENT_MISMATCH");
  }
  return snapshot;
}
export async function getOwnedPayPalSubscription(id: string, userId: string) {
  const [local] = await db.select().from(subscription).where(and(
    eq(subscription.id, id), eq(subscription.userId, userId), eq(subscription.provider, "paypal"),
  )).limit(1);
  if (!local) throw new PayPalError(404, "SUBSCRIPTION_NOT_FOUND");
  return local;
}
export async function hasManagedPayPalSubscription(userId: string, executor: Pick<typeof db, "select"> = db) {
  const [existing] = await executor.select({ id: subscription.id }).from(subscription).where(and(
    eq(subscription.userId, userId), eq(subscription.provider, "paypal"),
    or(inArray(subscription.status, openStates), gt(subscription.currentPeriodEnd, new Date()), eq(subscription.billingReview, true)),
  )).limit(1);
  return Boolean(existing);
}
export function publicPayPalSubscription(local: LocalSubscription) {
  return { id: local.id, planKey: local.planKey, status: local.status,
    paidThrough: local.currentPeriodEnd, nextBillingAt: local.nextBillingAt,
    reviewRequired: local.billingReview, approvalUrl: local.status === "approval_pending" ? local.approvalUrl : null };
}

export async function startPayPalSubscription(userId: string, key: string, requestId: string, locale: string) {
  if (!isSubscriptionKey(key) || !Object.hasOwn(subscriptionPlans, key)) throw new PayPalError(400, "INVALID_PLAN");
  const planId = getPayPalPlanId(key);
  const snapshot = createSubscriptionSnapshot(key, planId);
  validatePayPalPlan(snapshot, await getPayPalPlan(planId));
  const local = await db.transaction(async tx => {
    await lockUser(tx, userId);
    const [existing] = await tx.select().from(subscription).where(and(
      eq(subscription.userId, userId), eq(subscription.checkoutRequestId, requestId),
    )).limit(1);
    if (existing) {
      if (existing.provider !== "paypal" || existing.planKey !== key) throw new PayPalError(409, "REQUEST_CONFLICT");
      return existing;
    }
    const [other] = await tx.select({ id: subscription.id }).from(subscription).where(and(
      eq(subscription.userId, userId), or(inArray(subscription.status, openStates),
        gt(subscription.currentPeriodEnd, new Date()), eq(subscription.billingReview, true)),
    )).limit(1);
    if (other) throw new PayPalError(409, "SUBSCRIPTION_ALREADY_EXISTS");
    const id = randomUUID();
    const [created] = await tx.insert(subscription).values({
      id, provider: "paypal", providerSubId: `pending:${id}`, userId, planKey: key,
      status: "approval_pending", checkoutRequestId: requestId, billingSnapshot: JSON.stringify(snapshot), locale,
      createdAt: new Date(), updatedAt: new Date(),
    }).returning();
    return created;
  });
  snapshotFor(local);
  if (["canceled", "expired"].includes(local.status)) throw new PayPalError(409, "SUBSCRIPTION_FINISHED");
  if (local.approvalUrl && local.status === "approval_pending") return { id: local.id, url: local.approvalUrl };
  if (local.providerSubId.startsWith("pending:") && Date.now() - local.createdAt.getTime() > 5 * 3600_000) {
    throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
  }
  const created = local.providerSubId.startsWith("pending:")
    ? await createPayPalSubscription(local.id, snapshotFor(local).planId, local.locale || "en") : null;
  const remote = await getPayPalSubscription(created?.id || local.providerSubId);
  await applyPayPalSubscriptionState(local, remote);
  if (remote.status !== "APPROVAL_PENDING") return { id: local.id, url: getSubscriptionReturnUrl(local.id, local.locale || "en") };
  const approvalUrl = (created?.links || remote.links)?.find(link => link.rel === "approve")?.href;
  const host = snapshot.environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com";
  if (!approvalUrl || new URL(approvalUrl).protocol !== "https:" || new URL(approvalUrl).hostname !== host) {
    throw new PayPalError(502, "PAYPAL_APPROVAL_INVALID");
  }
  await db.update(subscription).set({ approvalUrl }).where(eq(subscription.id, local.id));
  return { id: local.id, url: approvalUrl };
}

async function markSubscriptionReview(local: LocalSubscription) {
  await db.transaction(async tx => {
    await lockUser(tx, local.userId);
    await tx.update(subscription).set({ billingReview: true }).where(eq(subscription.id, local.id));
    await refreshPlan(tx, local.userId);
  });
}
export async function applyPayPalSubscriptionState(local: LocalSubscription, remote: PayPalSubscription) {
  const snapshot = snapshotFor(local);
  try { validateSubscriptionReference(local.id, local.providerSubId, snapshot, remote); }
  catch (error) { await markSubscriptionReview(local); throw error; }
  return db.transaction(async tx => {
    await lockUser(tx, local.userId);
    const [current] = await tx.select().from(subscription).where(eq(subscription.id, local.id)).for("update");
    if (!current) throw new PayPalError(404, "SUBSCRIPTION_NOT_FOUND");
    validateSubscriptionReference(current.id, current.providerSubId, snapshot, remote);
    const stamp = new Date(remote.status_update_time);
    if (!shouldApplyProviderState(current, remote)) return current;
    const statuses: Record<string, string> = {
      APPROVAL_PENDING: "approval_pending", APPROVED: "approved", ACTIVE: "active",
      SUSPENDED: "suspended", CANCELLED: "canceled", EXPIRED: "expired",
    };
    const [updated] = await tx.update(subscription).set({
      providerSubId: remote.id, status: statuses[remote.status] || "needs_review",
      billingReview: current.billingReview || !statuses[remote.status], providerUpdatedAt: stamp, providerCheckedAt: new Date(),
      nextBillingAt: remote.billing_info?.next_billing_time ? new Date(remote.billing_info.next_billing_time) : null,
      raw: JSON.stringify({ id: remote.id, status: remote.status, planId: remote.plan_id }),
    }).where(eq(subscription.id, local.id)).returning();
    await refreshPlan(tx, local.userId);
    return updated;
  });
}

export async function resolvePayPalSubscription(remote: PayPalSubscription) {
  const [local] = await db.select().from(subscription).where(and(eq(subscription.provider, "paypal"),
    or(eq(subscription.providerSubId, remote.id), eq(subscription.id, remote.custom_id || "")),
  )).limit(1);
  return local ? applyPayPalSubscriptionState(local, remote) : null;
}

export async function settlePayPalSubscriptionPayment(localId: string, remote: PayPalSubscription, receipt: PayPalSubscriptionTransaction) {
  return db.transaction(async tx => {
    const [identity] = await tx.select({ userId: subscription.userId }).from(subscription).where(eq(subscription.id, localId)).limit(1);
    if (!identity) throw new PayPalError(404, "SUBSCRIPTION_NOT_FOUND");
    await lockUser(tx, identity.userId);
    const [local] = await tx.select().from(subscription).where(eq(subscription.id, localId)).for("update");
    if (!local || local.provider !== "paypal" || local.billingReview) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
    const snapshot = snapshotFor(local);
    validateSubscriptionReference(local.id, local.providerSubId, snapshot, remote);
    const cycle = buildPaidSubscriptionCycle(snapshot, receipt);
    if (cycle.paidAt.getTime() < local.createdAt.getTime() - 3600_000) throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_PAYMENT_MISMATCH");
    const id = `paypal:sale:${receipt.id}`;
    const [existing] = await tx.select().from(payment).where(eq(payment.id, id)).limit(1);
    if (existing) {
      if (existing.userId !== local.userId || existing.planKey !== local.planKey) throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_PAYMENT_MISMATCH");
      return local;
    }
    const [refund] = await tx.select({ id: paymentEvent.id }).from(paymentEvent).where(and(
      eq(paymentEvent.provider, "paypal"), eq(paymentEvent.resourceId, receipt.id),
      inArray(paymentEvent.eventType, ["PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"]),
    )).limit(1);
    if (refund) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
    const now = new Date();
    const creditsNow = cycle.grants.filter(grant => grant.dueAt <= now).reduce((total, grant) => total + grant.amount, 0);
    await tx.insert(payment).values({
      id, provider: "paypal", providerPaymentId: id, userId: local.userId,
      amountCents: snapshot.amountCents, currency: snapshot.currency, status: "succeeded", type: "subscription",
      planKey: local.planKey, creditsGranted: creditsNow,
      raw: JSON.stringify({ subscriptionId: local.id, providerSubscriptionId: remote.id, transactionId: receipt.id, paidAt: receipt.time }),
    });
    await tx.insert(subscriptionCreditGrant).values(cycle.grants.map(grant => ({
      id: `${id}:${grant.index}`, subscriptionId: local.id, paymentId: id, userId: local.userId,
      amount: grant.amount, dueAt: grant.dueAt, grantedAt: grant.dueAt <= now ? now : null,
    })));
    if (creditsNow > 0) {
      await tx.update(user).set({ credits: sql`${user.credits} + ${creditsNow}` }).where(eq(user.id, local.userId));
      await tx.insert(creditLedger).values({ id: randomUUID(), userId: local.userId, delta: creditsNow, reason: "subscription_cycle", paymentId: id });
    }
    const [updated] = await tx.update(subscription).set({
      currentPeriodEnd: local.currentPeriodEnd && local.currentPeriodEnd > cycle.paidThrough ? local.currentPeriodEnd : cycle.paidThrough,
    }).where(eq(subscription.id, local.id)).returning();
    await refreshPlan(tx, local.userId, now);
    return updated;
  });
}

export async function syncPayPalSubscription(localId: string, expectedTransaction?: { id: string; time: string }) {
  const [local] = await db.select().from(subscription).where(and(eq(subscription.id, localId), eq(subscription.provider, "paypal"))).limit(1);
  if (!local) throw new PayPalError(404, "SUBSCRIPTION_NOT_FOUND");
  snapshotFor(local);
  if (local.providerSubId.startsWith("pending:")) return local;
  const remote = await getPayPalSubscription(local.providerSubId);
  let updated = await applyPayPalSubscriptionState(local, remote);
  if (!["APPROVAL_PENDING", "APPROVED"].includes(remote.status)) {
    // Advance a bounded reconciliation cursor instead of only reading the last
    // payment. This recovers multiple missed renewals after a long outage.
    const window = subscriptionTransactionWindow(local.createdAt, local.transactionsCheckedThrough);
    const start = window.start;
    let end = window.end;
    const receipts = expectedTransaction
      ? await listPayPalSubscriptionTransactions(remote.id, new Date(expectedTransaction.time))
      : await listPayPalSubscriptionTransactions(remote.id, start, end);
    const matching = expectedTransaction ? receipts.filter(receipt => receipt.id === expectedTransaction.id) : receipts;
    if (matching.some(receipt => ["REFUNDED", "PARTIALLY_REFUNDED"].includes(receipt.status))) {
      await markSubscriptionReview(local);
      throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
    }
    if (expectedTransaction && !matching.some(receipt => receipt.status === "COMPLETED")) throw new PayPalError(502, "PAYPAL_PAYMENT_NOT_SETTLED");
    for (const receipt of matching.filter(receipt => receipt.status === "COMPLETED")) {
      updated = await settlePayPalSubscriptionPayment(local.id, remote, receipt);
    }
    // Pending funding can complete days later with the original transaction time.
    // Do not move the cursor past it, even if its webhook never arrives.
    for (const pending of receipts.filter(receipt => receipt.status === "PENDING")) {
      const time = new Date(pending.time);
      if (time < end) end = time;
    }
    if (!expectedTransaction) await db.update(subscription).set({ transactionsCheckedThrough: end }).where(and(
      eq(subscription.id, local.id), or(isNull(subscription.transactionsCheckedThrough), lt(subscription.transactionsCheckedThrough, end)),
    ));
  }
  return updated;
}

export async function cancelOwnedPayPalSubscription(id: string, userId: string) {
  let local = await getOwnedPayPalSubscription(id, userId);
  snapshotFor(local);
  if (local.providerSubId.startsWith("pending:")) throw new PayPalError(409, "SUBSCRIPTION_REQUIRES_REVIEW");
  const remote = await getPayPalSubscription(local.providerSubId);
  local = await applyPayPalSubscriptionState(local, remote);
  if (["canceled", "expired"].includes(local.status)) return local;
  try { await cancelPayPalSubscription(local.providerSubId); }
  catch (error) {
    const recovered = await getPayPalSubscription(local.providerSubId);
    if (!["CANCELLED", "EXPIRED"].includes(recovered.status)) throw error;
    return applyPayPalSubscriptionState(local, recovered);
  }
  return applyPayPalSubscriptionState(local, await getPayPalSubscription(local.providerSubId));
}

export async function reviewPayPalSubscriptionSale(saleId: string, providerSubId?: string) {
  const [record] = await db.select().from(payment).where(eq(payment.id, `paypal:sale:${saleId}`)).limit(1);
  let localId: string | undefined;
  if (record?.raw) {
    const raw = JSON.parse(record.raw) as { subscriptionId?: string };
    localId = raw.subscriptionId;
  }
  const [local] = await db.select().from(subscription).where(and(eq(subscription.provider, "paypal"),
    or(eq(subscription.id, localId || ""), eq(subscription.providerSubId, providerSubId || "")),
  )).limit(1);
  if (local) await markSubscriptionReview(local);
}

export async function processDuePayPalGrants(limit = 50) {
  const now = new Date();
  const candidates = await db.select({ id: subscriptionCreditGrant.id, userId: subscriptionCreditGrant.userId })
    .from(subscriptionCreditGrant).innerJoin(subscription, eq(subscription.id, subscriptionCreditGrant.subscriptionId))
    .where(and(isNull(subscriptionCreditGrant.grantedAt), lte(subscriptionCreditGrant.dueAt, now), eq(subscription.billingReview, false)))
    .orderBy(subscriptionCreditGrant.dueAt).limit(limit);
  let granted = 0;
  for (const candidate of candidates) {
    granted += await db.transaction(async tx => {
      // Same lock order as payment/state handling prevents grant/cancel deadlocks.
      await lockUser(tx, candidate.userId);
      const [grant] = await tx.select().from(subscriptionCreditGrant).where(and(
        eq(subscriptionCreditGrant.id, candidate.id), isNull(subscriptionCreditGrant.grantedAt),
      )).for("update");
      if (!grant) return 0;
      const [local] = await tx.select().from(subscription).where(eq(subscription.id, grant.subscriptionId)).limit(1);
      if (!local || local.billingReview) return 0;
      const [paid] = await tx.select().from(payment).where(eq(payment.id, grant.paymentId)).limit(1);
      if (!paid || paid.status !== "succeeded") return 0;
      await tx.update(user).set({ credits: sql`${user.credits} + ${grant.amount}` }).where(eq(user.id, grant.userId));
      await tx.insert(creditLedger).values({ id: randomUUID(), userId: grant.userId, delta: grant.amount, reason: "subscription_schedule", paymentId: grant.paymentId });
      await tx.update(payment).set({ creditsGranted: sql`${payment.creditsGranted} + ${grant.amount}` }).where(eq(payment.id, grant.paymentId));
      await tx.update(subscriptionCreditGrant).set({ grantedAt: now }).where(eq(subscriptionCreditGrant.id, grant.id));
      return 1;
    });
  }
  const expired = await db.selectDistinct({ userId: subscription.userId }).from(subscription)
    .innerJoin(user, eq(user.id, subscription.userId)).where(and(
      eq(subscription.provider, "paypal"), lte(subscription.currentPeriodEnd, now), ne(user.planKey, "free"),
      notInArray(user.id, db.select({ id: subscription.userId }).from(subscription).where(paidSubscription(now))),
    )).limit(limit);
  for (const item of expired) await db.transaction(async tx => { await lockUser(tx, item.userId); await refreshPlan(tx, item.userId, now); });
  return granted;
}

export async function reconcilePayPalSubscriptions(limit = 5) {
  if (!isPayPalEnabled()) return { checked: 0, failed: 0 };
  const candidates = await db.select().from(subscription).where(and(
    eq(subscription.provider, "paypal"), eq(subscription.billingReview, false),
    or(inArray(subscription.status, openStates), gt(subscription.currentPeriodEnd, new Date()),
      isNull(subscription.transactionsCheckedThrough), lt(subscription.transactionsCheckedThrough, subscription.providerUpdatedAt),
      gt(subscription.providerUpdatedAt, new Date(Date.now() - 2 * 86_400_000))),
  )).orderBy(sql`${subscription.providerCheckedAt} asc nulls first`, subscription.createdAt).limit(limit);
  let failed = 0;
  for (const local of candidates) {
    try { await syncPayPalSubscription(local.id); }
    catch { failed++; console.error("[PayPal] Subscription reconciliation failed", { subscriptionId: local.id }); }
    finally { await db.update(subscription).set({ providerCheckedAt: new Date() }).where(eq(subscription.id, local.id)); }
  }
  return { checked: candidates.length, failed };
}
