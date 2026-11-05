import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapAsset, rapModeration } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
import { MODERATION_POLICY_VERSION } from "@/lib/rap/moderation";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rapAccess(request); const { id } = await context.params;
    const [asset] = await db.select().from(rapAsset).where(and(eq(rapAsset.id, id), eq(rapAsset.userId, user.id)));
    if (!asset || !asset.storageKey || asset.expiresAt <= new Date()) throw new RapError(404, "PHOTOS_EXPIRED");
    const [review] = asset.mediaHash ? await db.select().from(rapModeration).where(and(eq(rapModeration.assetId, id),
      eq(rapModeration.mediaHash, asset.mediaHash), eq(rapModeration.policyVersion, MODERATION_POLICY_VERSION))) : [];
    return privateJson({ assetId: id, moderationStatus: review?.status === "submitting" ? "processing" : review?.status || "pending" });
  } catch (error) { return rapErrorResponse(error); }
}
