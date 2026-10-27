import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapFeedback } from "@/lib/db/schema";
import { ownedOrder } from "@/lib/rap/repository";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { feedbackSchema } from "@/lib/rap/validation";
import { RapError } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rapAccess(request, true); const { id } = await context.params; const order = await ownedOrder(id, user.id);
    if (!order.paymentId) throw new RapError(409, "PAYMENT_NOT_CONFIRMED");
    const input = feedbackSchema.parse(await request.json());
    await db.insert(rapFeedback).values({ id: randomUUID(), userId: user.id, orderId: id, ...input })
      .onConflictDoNothing({ target: [rapFeedback.userId, rapFeedback.orderId] });
    const [saved] = await db.select({ id: rapFeedback.id, status: rapFeedback.status }).from(rapFeedback).where(and(eq(rapFeedback.userId, user.id), eq(rapFeedback.orderId, id)));
    return privateJson({ feedback: saved }, 201);
  } catch (error) { return rapErrorResponse(error); }
}
