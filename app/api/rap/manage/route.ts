import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { rapAudit, rapFeedback, rapGeneration, rapOrder, rapMetric, payment } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
import { activeStatuses } from "@/lib/rap/repository";
import { resolutionSchema } from "@/lib/rap/validation";
import { getPayPalConfig, paypalRequest } from "@/lib/payments/paypal";
import { amountToCents } from "@/lib/payments/paypal-validation";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await rapAccess(request); if (user.role !== "admin") throw new RapError(403, "ADMIN_REQUIRED");
    const feedback = await db.select().from(rapFeedback).orderBy(desc(rapFeedback.createdAt)).limit(100);
    const orders = await db.select({ id: rapOrder.id, userId: rapOrder.userId, status: rapOrder.status, retryCredits: rapOrder.retryCredits,
      amountCents: rapOrder.amountCents, createdAt: rapOrder.createdAt }).from(rapOrder).orderBy(desc(rapOrder.createdAt)).limit(100);
    const tasks = await db.select({ id: rapGeneration.id, orderId: rapGeneration.orderId, status: rapGeneration.status, error: rapGeneration.error,
      providerTaskId: rapGeneration.providerTaskId, providerCredits: rapGeneration.providerCredits, createdAt: rapGeneration.createdAt })
      .from(rapGeneration).orderBy(desc(rapGeneration.createdAt)).limit(200);
    const counts = await db.select({ kind: rapAudit.kind, count: sql<number>`count(*)::int` }).from(rapAudit).groupBy(rapAudit.kind);
    const funnel = await db.select({ kind: rapMetric.event, count: sql<number>`count(*)::int` }).from(rapMetric).groupBy(rapMetric.event);
    return privateJson({ feedback, orders, tasks, counts: [...counts, ...funnel] });
  } catch (error) { return rapErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await rapAccess(request, true); if (user.role !== "admin") throw new RapError(403, "ADMIN_REQUIRED");
    const input = resolutionSchema.extend({ feedbackId: z.uuid() }).parse(await request.json());
    const [item] = await db.select().from(rapFeedback).where(eq(rapFeedback.id, input.feedbackId));
    if (!item) throw new RapError(404, "FEEDBACK_NOT_FOUND");
    const [original] = await db.select().from(rapOrder).where(eq(rapOrder.id, item.orderId));
    if (input.action === "refund_recorded") {
      if (!input.refundId || !original.paymentId) throw new RapError(400, "REFUND_REFERENCE_REQUIRED");
      const config = getPayPalConfig();
      if (original.environment !== config.environment || original.merchantId !== config.merchantId) throw new RapError(409, "PAYMENT_ENVIRONMENT_MISMATCH");
      // This records a full refund already performed in PayPal; never issues one
      // as a side effect of a support form. Verify it before freezing rights.
      const refund = z.object({ status: z.literal("COMPLETED"), amount: z.object({ value: z.string(), currency_code: z.literal("USD") }),
        links: z.array(z.object({ rel: z.string(), href: z.string() })) }).parse(await paypalRequest(`/v2/payments/refunds/${encodeURIComponent(input.refundId)}`));
      const capture = original.paymentId.replace(/^paypal:/, "");
      if (amountToCents(refund.amount.value) !== original.amountCents || !refund.links.some(l => l.rel === "up" && l.href === `${config.baseUrl}/v2/payments/captures/${capture}`)) throw new RapError(409, "REFUND_MISMATCH");
    }
    await db.transaction(async tx => {
      const [order] = await tx.select().from(rapOrder).where(eq(rapOrder.id, item.orderId)).for("update");
      const [current] = await tx.select().from(rapFeedback).where(eq(rapFeedback.id, item.id)).for("update");
      if (current.status !== "open") throw new RapError(409, "REQUEST_ALREADY_RESOLVED");
      if (input.action === "replacement") {
        if (order.status !== "paid") throw new RapError(409, "PAYMENT_REVIEW");
        const active = await tx.select().from(rapGeneration).where(and(eq(rapGeneration.orderId, order.id), inArray(rapGeneration.status, activeStatuses))).limit(1);
        if (active.length || order.retryCredits > 0) throw new RapError(409, "TASK_OR_REPLACEMENT_ALREADY_ACTIVE");
        await tx.update(rapOrder).set({ retryCredits: 1 }).where(eq(rapOrder.id, order.id));
      }
      if (input.action === "refund_recorded") {
        await tx.update(rapOrder).set({ status: "refunded", retryCredits: 0, updatedAt: new Date() }).where(eq(rapOrder.id, order.id));
        if (order.paymentId) await tx.update(payment).set({ status: "refunded" }).where(eq(payment.id, order.paymentId));
        await tx.update(rapGeneration).set({ status: "requires_review", error: "REFUNDED_ORDER" }).where(and(eq(rapGeneration.orderId, order.id), inArray(rapGeneration.status, activeStatuses)));
      }
      await tx.insert(rapAudit).values({ id: `support:${current.id}`, orderId: order.id, kind: input.action,
        note: JSON.stringify({ adminId: user.id, note: input.note, refundId: input.refundId }) });
      await tx.update(rapFeedback).set({ status: "resolved", resolution: input.note, updatedAt: new Date() }).where(eq(rapFeedback.id, item.id));
    });
    return privateJson({ resolved: true, reference: randomUUID() });
  } catch (error) { return rapErrorResponse(error); }
}
