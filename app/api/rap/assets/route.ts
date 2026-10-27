import { savePortrait } from "@/lib/rap/repository";
import { rapAccess, rapErrorResponse, privateJson } from "@/lib/rap/http";
import { RAP_PRODUCT, RapError } from "@/lib/rap/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const user = await rapAccess(request, true);
    if (Number(request.headers.get("content-length") || 0) > RAP_PRODUCT.maxImageBytes + 100_000) throw new RapError(413, "PHOTO_SIZE_INVALID");
    const data = await request.formData(); const file = data.get("file");
    if (!(file instanceof File) || file.size > RAP_PRODUCT.maxImageBytes) throw new RapError(400, "PHOTO_SIZE_INVALID");
    return privateJson(await savePortrait(user.id, Buffer.from(await file.arrayBuffer())), 201);
  } catch (error) { return rapErrorResponse(error); }
}
