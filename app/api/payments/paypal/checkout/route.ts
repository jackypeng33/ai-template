import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { startPayPalCheckout } from "@/lib/payments/paypal-orders";
import { checkPaymentOrigin, paypalErrorResponse } from "@/lib/payments/paypal-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z.object({ key: z.string().max(64), requestId: z.string().uuid(), locale: z.enum(["en", "zh"]) }).strict();

export async function POST(request: NextRequest) {
  try {
    checkPaymentOrigin(request);
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return NextResponse.json(await startPayPalCheckout(access.user.id, body.data.key, body.data.requestId, body.data.locale));
  } catch (error) { return paypalErrorResponse(error); }
}
