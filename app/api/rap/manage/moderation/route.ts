import { z } from "zod";
import { retryRapModeration } from "@/lib/rap/moderation";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await rapAccess(request, true); if (user.role !== "admin") throw new RapError(403, "ADMIN_REQUIRED");
    const { id } = z.object({ id: z.uuid() }).strict().parse(await request.json());
    await retryRapModeration(id);
    return privateJson({ queued: true });
  } catch (error) { return rapErrorResponse(error); }
}
