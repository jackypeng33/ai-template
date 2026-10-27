import { db } from "@/lib/db";
import { billingOrder, creditLedger, payment, user } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { PayPalError, type PayPalCapture, type PayPalOrder } from "./paypal";
import { validatePayPalCapture } from "./paypal-validation";

// Both the authenticated capture endpoint and verified webhook use this path.
// Locking the local order serializes their race; every accounting write commits
// together. A crash/rollback leaves the next attempt free to complete the grant.
export async function settlePayPalCapture(localOrderId: string, remote: PayPalOrder, capture: PayPalCapture) {
  return db.transaction(async tx => {
    const [order] = await tx.select().from(billingOrder)
      .where(eq(billingOrder.id, localOrderId)).for("update");
    if (!order || order.provider !== "paypal") throw new PayPalError(404, "ORDER_NOT_FOUND");
    validatePayPalCapture(order, remote, capture);
    const paymentId = `paypal:${capture.id}`;
    if (order.status === "succeeded") {
      if (order.paymentId !== paymentId) throw new PayPalError(409, "PAYPAL_CAPTURE_MISMATCH");
      return order;
    }
    await tx.insert(payment).values({
      id: paymentId, provider: "paypal", providerPaymentId: paymentId,
      userId: order.userId, amountCents: order.amountCents, currency: order.currency,
      status: "succeeded", type: "one_time", creditsGranted: order.credits,
      raw: JSON.stringify({ orderId: remote.id, captureId: capture.id, packKey: order.packKey }),
    });
    const updatedUsers = await tx.update(user).set({ credits: sql`${user.credits} + ${order.credits}` })
      .where(eq(user.id, order.userId)).returning({ id: user.id });
    if (updatedUsers.length !== 1) throw new PayPalError(404, "ORDER_NOT_FOUND");
    await tx.insert(creditLedger).values({
      id: randomUUID(), userId: order.userId, delta: order.credits,
      reason: "one_time_pack", paymentId,
    });
    const [settled] = await tx.update(billingOrder)
      .set({ status: "succeeded", paymentId, providerOrderId: remote.id, updatedAt: new Date() })
      .where(eq(billingOrder.id, order.id)).returning();
    return settled;
  });
}
