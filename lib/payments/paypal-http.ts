import { NextResponse } from "next/server";
import { PayPalError } from "./paypal";

export function paypalErrorResponse(error: unknown) {
  const known = error instanceof PayPalError;
  console.error("[PayPal] Request failed", known ? error.code : "INTERNAL_ERROR");
  return NextResponse.json({ error: known ? error.code : "PAYPAL_REQUEST_FAILED" }, { status: known ? error.status : 502 });
}

export function checkPaymentOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  if (origin && origin !== expected) throw new PayPalError(403, "INVALID_ORIGIN");
}
