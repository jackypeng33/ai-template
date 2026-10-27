import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapGeneration } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { ownedOrder, retryRapGeneration } from "@/lib/rap/repository";
import { retrySchema } from "@/lib/rap/validation";
import { completeRapPayment } from "@/lib/rap/payments";
import { RapError, rapGenerationEnabled } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await rapAccess(request); const { id } = await context.params; const order = await ownedOrder(id, user.id);
    const generations = await db.select({ id: rapGeneration.id, status: rapGeneration.status, error: rapGeneration.error,
      createdAt: rapGeneration.createdAt, resultExpiresAt: rapGeneration.resultExpiresAt }).from(rapGeneration)
      .where(and(eq(rapGeneration.orderId, id), eq(rapGeneration.userId, user.id))).orderBy(desc(rapGeneration.createdAt));
    return privateJson({ order: { id, status: order.status, amountCents: order.amountCents, retryCredits: order.retryCredits, generations } });
  } catch (error) { return rapErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const user = await rapAccess(request, true); const { id } = await context.params;
    const body = await request.json();
    if (body.action === "sync" && Object.keys(body).length === 1) {
      await completeRapPayment(id, user.id); return privateJson({ synced: true });
    }
    if (!rapGenerationEnabled()) throw new RapError(503, "GENERATION_DISABLED");
    const { action, ...input } = body;
    if (action !== "retry") throw new RapError(400, "INVALID_REQUEST");
    const result = await retryRapGeneration(id, user.id, retrySchema.parse(input));
    return privateJson({ generationId: result.id, status: result.status }, 202);
  } catch (error) { return rapErrorResponse(error); }
}
