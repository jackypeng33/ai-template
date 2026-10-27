import { z } from "zod";
import { db } from "@/lib/db";
import { paymentEvent } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { completePayPalOrder, resolvePayPalNotificationOrder } from "./paypal-orders";
import { getPayPalCapture } from "./paypal";
import { processPayPalSubscriptionEvent } from "./paypal-subscription-events";

export const paypalEventSchema = z.object({
  id: z.string().min(1).max(128), event_type: z.string().min(1).max(128),
  resource: z.object({
    id: z.string().min(1).max(128),
    billing_agreement_id: z.string().max(128).optional(),
    create_time: z.string().datetime({ offset: true }).optional(),
    supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional(), capture_id: z.string().optional() }).optional() }).optional(),
  }).passthrough(),
}).passthrough();

export async function processPayPalWebhook(event: z.infer<typeof paypalEventSchema>) {
  const eventId = `paypal:${event.id}`;
  const [saved] = await db.insert(paymentEvent).values({
    id: eventId, provider: "paypal", eventType: event.event_type,
    resourceId: event.resource.id,
    providerOrderId: event.resource.supplementary_data?.related_ids?.order_id,
  }).onConflictDoNothing().returning();
  if (!saved) {
    const [existing] = await db.select().from(paymentEvent).where(eq(paymentEvent.id, eventId)).limit(1);
    if (existing && ["processed", "ignored", "requires_review"].includes(existing.status)) return;
  }
  try {
    if (event.event_type.startsWith("BILLING.SUBSCRIPTION.") ||
        ["PAYMENT.SALE.COMPLETED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"].includes(event.event_type)) {
      const result = await processPayPalSubscriptionEvent(event);
      await db.update(paymentEvent).set({ ...result, error: null, updatedAt: new Date() }).where(eq(paymentEvent.id, eventId));
      return;
    }
    let providerOrderId: string | undefined;
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      providerOrderId = event.resource.id;
    } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      // Fetch authoritative capture data instead of trusting optional event fields.
      const capture = await getPayPalCapture(event.resource.id);
      providerOrderId = capture.supplementary_data?.related_ids?.order_id;
      if (!providerOrderId) throw new Error("PAYPAL_ORDER_REFERENCE_MISSING");
    } else if (["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(event.event_type)) {
      // Refund policy (including already-spent credits) requires an explicit
      // product decision. Keep a durable review item instead of silently ignoring it.
      await db.update(paymentEvent).set({ status: "requires_review", updatedAt: new Date() })
        .where(eq(paymentEvent.id, eventId));
      console.error("[PayPal] Refund/reversal requires review", { eventId, resourceId: event.resource.id });
      return;
    }
    if (!providerOrderId) {
      await db.update(paymentEvent).set({ status: "ignored", updatedAt: new Date() }).where(eq(paymentEvent.id, eventId));
      return;
    }
    const order = await resolvePayPalNotificationOrder(providerOrderId);
    if (order) {
      const result = await completePayPalOrder(order.id);
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && result.status !== "succeeded") {
        // Ask PayPal to retry if its read API has not caught up with the event.
        throw new Error("PAYPAL_PAYMENT_NOT_SETTLED");
      }
    }
    await db.update(paymentEvent).set({
      providerOrderId, status: order ? "processed" : "ignored", error: null, updatedAt: new Date(),
    }).where(eq(paymentEvent.id, eventId));
  } catch (error) {
    await db.update(paymentEvent).set({ status: "failed", error: "Processing failed; replay this event", updatedAt: new Date() })
      .where(eq(paymentEvent.id, eventId));
    throw error;
  }
}
