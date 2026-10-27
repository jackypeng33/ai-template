import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapGeneration, rapAudit, rapOrder } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
import { getRapObject } from "@/lib/rap/storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rapAccess(request); const { id } = await context.params;
    const [task] = await db.select().from(rapGeneration).where(and(eq(rapGeneration.id, id), eq(rapGeneration.userId, user.id)));
    if (!task) throw new RapError(404, "VIDEO_NOT_FOUND");
    const [order] = await db.select().from(rapOrder).where(eq(rapOrder.id, task.orderId));
    if (order.status !== "paid") throw new RapError(409, "PAYMENT_REVIEW");
    if (task.status !== "succeeded" || !task.resultKey || !task.resultExpiresAt || task.resultExpiresAt <= new Date()) throw new RapError(410, "VIDEO_UNAVAILABLE");
    const body = await getRapObject(task.resultKey); const download = new URL(request.url).searchParams.get("download") === "1";
    if (download) await db.insert(rapAudit).values({ id: `download:${id}`, orderId: task.orderId, generationId: id, kind: "download_requested", note: randomUUID() }).onConflictDoNothing();
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "video/mp4", "Content-Length": String(body.length),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="booth-${id}.mp4"` } });
  } catch (error) { return rapErrorResponse(error); }
}
