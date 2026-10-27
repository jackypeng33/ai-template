import { z } from "zod";
import { db } from "@/lib/db";
import { rapMetric } from "@/lib/db/schema";
import { checkRapOrigin } from "@/lib/rap/validation";
import { privateJson, rapErrorResponse } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
const eventSchema = z.object({ sessionId: z.uuid(), event: z.enum(["visit", "photos_selected", "sign_in_opened", "checkout_clicked"]) }).strict();
export async function POST(request: Request) {
  try {
    checkRapOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 512) throw new RapError(413, "INVALID_REQUEST");
    const input = eventSchema.parse(await request.json());
    await db.insert(rapMetric).values({ ...input, id: `${input.sessionId}:${input.event}` }).onConflictDoNothing();
    return privateJson({ recorded: true });
  } catch (error) { return rapErrorResponse(error); }
}
