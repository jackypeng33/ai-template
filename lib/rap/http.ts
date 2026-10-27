import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { PayPalError } from "@/lib/payments/paypal";
import { RapError } from "./config";
import { checkRapOrigin } from "./validation";

export async function rapAccess(request: Request, mutate = false) {
  if (mutate) checkRapOrigin(request);
  const access = await getActiveSessionUser(request.headers);
  if (!access.ok) throw new RapError(access.status, access.error === "Unauthorized" ? "SIGN_IN_REQUIRED" : "ACCESS_DENIED");
  return access.user;
}
export function rapErrorResponse(error: unknown) {
  if (error instanceof RapError || error instanceof PayPalError) return NextResponse.json({ error: error.code }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  console.error("[BOOTH] Request failed", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
}
export function privateJson(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
