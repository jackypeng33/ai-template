import { PayPalError } from "./paypal";
import { getPayPalSubscription } from "./paypal-subscription-api";
import { resolvePayPalSubscription, reviewPayPalSubscriptionSale, syncPayPalSubscription } from "./paypal-subscriptions";

export async function processPayPalSubscriptionEvent(event: {
  event_type: string;
  resource: { id: string; billing_agreement_id?: string; create_time?: string };
}) {
  const type = event.event_type;
  const providerSubId = type.startsWith("BILLING.SUBSCRIPTION.") ? event.resource.id : event.resource.billing_agreement_id;
  if (["PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"].includes(type)) {
    await reviewPayPalSubscriptionSale(event.resource.id, providerSubId);
    return { status: "requires_review", providerSubscriptionId: providerSubId };
  }
  if (!providerSubId) throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_REFERENCE_MISSING");
  // Fetch current provider state, never blindly apply an old event's status.
  const remote = await getPayPalSubscription(providerSubId);
  const local = await resolvePayPalSubscription(remote);
  if (!local) return { status: "ignored", providerSubscriptionId: providerSubId };
  if (type === "PAYMENT.SALE.COMPLETED") {
    if (!event.resource.create_time) throw new PayPalError(409, "PAYPAL_SUBSCRIPTION_REFERENCE_MISSING");
    await syncPayPalSubscription(local.id, { id: event.resource.id, time: event.resource.create_time });
  } else {
    await syncPayPalSubscription(local.id);
  }
  return { status: "processed", providerSubscriptionId: providerSubId };
}
