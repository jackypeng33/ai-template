import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { rapUpload } from "@/lib/db/schema";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RAP_PRODUCT, RapError } from "@/lib/rap/config";
import { getRapUploadUrl, rapStorageReady } from "@/lib/rap/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(RAP_PRODUCT.maxImageBytes) }).strict();
export async function POST(request: Request) {
  try {
    const user = await rapAccess(request, true);
    if (!rapStorageReady()) throw new RapError(503, "PRIVATE_STORAGE_REQUIRED");
    const input = inputSchema.parse(await request.json());
    const id = randomUUID(); const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[input.contentType];
    const storageKey = `temp/${randomUUID()}/${id}.${ext}`;
    await db.transaction(async tx => {
      // Serialize each user's quota check and insertion across app instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rap-upload'), hashtext(${user.id}))`);
      const recent = await tx.select({ id: rapUpload.id }).from(rapUpload).where(and(eq(rapUpload.userId, user.id),
        gt(rapUpload.createdAt, new Date(Date.now() - 3600_000)))).limit(40);
      if (recent.length >= 40) throw new RapError(429, "UPLOAD_LIMIT_REACHED");
      await tx.insert(rapUpload).values({ id, userId: user.id, storageKey, contentType: input.contentType, size: input.size,
        expiresAt: new Date(Date.now() + 24 * 3600_000) });
    });
    return privateJson({ uploadId: id, url: await getRapUploadUrl(storageKey, input.contentType) }, 201);
  } catch (error) { return rapErrorResponse(error); }
}
