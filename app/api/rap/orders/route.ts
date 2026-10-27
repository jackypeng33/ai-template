import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapOrder, rapGeneration } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { checkoutSchema } from "@/lib/rap/validation";
import { startRapCheckout } from "@/lib/rap/payments";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { const user = await rapAccess(request, true); return privateJson(await startRapCheckout(user.id, checkoutSchema.parse(await request.json()))); }
  catch (error) { return rapErrorResponse(error); }
}
export async function GET(request: Request) {
  try {
    const user = await rapAccess(request);
    const orders = await db.select({ id: rapOrder.id, status: rapOrder.status, amountCents: rapOrder.amountCents,
      retryCredits: rapOrder.retryCredits, createdAt: rapOrder.createdAt }).from(rapOrder).where(eq(rapOrder.userId, user.id)).orderBy(desc(rapOrder.createdAt)).limit(50);
    const tasks = await db.select({ id: rapGeneration.id, orderId: rapGeneration.orderId, status: rapGeneration.status,
      createdAt: rapGeneration.createdAt, resultExpiresAt: rapGeneration.resultExpiresAt, error: rapGeneration.error })
      .from(rapGeneration).where(eq(rapGeneration.userId, user.id)).orderBy(desc(rapGeneration.createdAt)).limit(100);
    return privateJson({ orders: orders.map(order => ({ ...order, generations: tasks.filter(t => t.orderId === order.id) })) });
  } catch (error) { return rapErrorResponse(error); }
}
