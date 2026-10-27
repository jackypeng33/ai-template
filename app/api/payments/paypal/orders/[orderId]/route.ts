import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { getOwnedPayPalOrder, publicPayPalOrder } from "@/lib/payments/paypal-orders";
import { paypalErrorResponse } from "@/lib/payments/paypal-http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, props: { params: Promise<{ orderId: string }> }) {
  try {
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { orderId } = await props.params;
    if (!z.string().uuid().safeParse(orderId).success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return NextResponse.json({ order: publicPayPalOrder(await getOwnedPayPalOrder(orderId, access.user.id)) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) { return paypalErrorResponse(error); }
}
