import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { completePayPalOrder, getOwnedPayPalOrder, publicPayPalOrder } from "@/lib/payments/paypal-orders";
import { checkPaymentOrigin, paypalErrorResponse } from "@/lib/payments/paypal-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bodySchema = z.object({ orderId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  try {
    checkPaymentOrigin(request);
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    await getOwnedPayPalOrder(body.data.orderId, access.user.id);
    return NextResponse.json({ order: publicPayPalOrder(await completePayPalOrder(body.data.orderId)) });
  } catch (error) { return paypalErrorResponse(error); }
}
