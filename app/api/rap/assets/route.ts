import { rapAccess, rapErrorResponse } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// All uploads must pass the shared quota and confirmation flow.
export async function POST(request: Request) {
  try {
    await rapAccess(request, true);
    throw new RapError(410, "USE_DIRECT_UPLOAD");
  } catch (error) { return rapErrorResponse(error); }
}
