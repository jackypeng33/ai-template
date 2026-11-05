import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { rapUpload, rapAsset } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RAP_PRODUCT, RapError } from "@/lib/rap/config";
import { getRapObject, headRapObject, deleteRapObject } from "@/lib/rap/storage";
import { savePortrait } from "@/lib/rap/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await rapAccess(request, true); const { id } = await context.params;
    const [intent] = await db.select().from(rapUpload).where(and(eq(rapUpload.id, id), eq(rapUpload.userId, user.id)));
    if (!intent) throw new RapError(404, "UPLOAD_NOT_FOUND");
    if (intent.status === "completed" && intent.assetId) {
      const [asset] = await db.select().from(rapAsset).where(and(eq(rapAsset.id, intent.assetId), eq(rapAsset.userId, user.id)));
      if (!asset?.storageKey || asset.expiresAt <= new Date()) throw new RapError(410, "PHOTOS_EXPIRED");
      return privateJson({ assetId: asset.id });
    }
    if (intent.status === "rejected" || intent.expiresAt <= new Date()) throw new RapError(410, "UPLOAD_EXPIRED");
    const lease = new Date(Date.now() + 120_000);
    const claimed = await db.update(rapUpload).set({ leaseUntil: lease }).where(and(eq(rapUpload.id, id), eq(rapUpload.status, "pending"),
      or(isNull(rapUpload.leaseUntil), lt(rapUpload.leaseUntil, new Date())))).returning();
    if (!claimed.length) throw new RapError(409, "UPLOAD_CONFIRMING");
    try {
      const head = await headRapObject(intent.storageKey);
      if (head.size !== intent.size || !head.size || head.size > RAP_PRODUCT.maxImageBytes || head.contentType !== intent.contentType) {
        await db.update(rapUpload).set({ status: "rejected", leaseUntil: null }).where(and(eq(rapUpload.id, id), eq(rapUpload.leaseUntil, lease)));
        await deleteRapObject(intent.storageKey);
        throw new RapError(400, "PHOTO_INVALID");
      }
      // Re-read and decode actual bytes. A reusable PUT URL can only overwrite the
      // temporary object, never the new normalized immutable business object.
      const bytes = await getRapObject(intent.storageKey, RAP_PRODUCT.maxImageBytes);
      if (bytes.length !== intent.size) throw new RapError(400, "PHOTO_INVALID");
      const asset = await savePortrait(user.id, bytes);
      const updated = await db.update(rapUpload).set({ assetId: asset.assetId, status: "completed", leaseUntil: null })
        .where(and(eq(rapUpload.id, id), eq(rapUpload.leaseUntil, lease))).returning();
      if (!updated.length) throw new RapError(409, "UPLOAD_CONFIRMING");
      // Raw objects remain isolated and are swept at 24h (PUT URL lives 5 min).
      return privateJson(asset, 201);
    } catch (error) {
      await db.update(rapUpload).set({ leaseUntil: null }).where(and(eq(rapUpload.id, id), eq(rapUpload.leaseUntil, lease)));
      throw error;
    }
  } catch (error) { return rapErrorResponse(error); }
}
