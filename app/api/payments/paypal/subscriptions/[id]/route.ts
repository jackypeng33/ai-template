import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveSessionUser } from "@/lib/auth/session";
import { checkPaymentOrigin, paypalErrorResponse } from "@/lib/payments/paypal-http";
import { cancelOwnedPayPalSubscription, getOwnedPayPalSubscription, publicPayPalSubscription, syncPayPalSubscription } from "@/lib/payments/paypal-subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    checkPaymentOrigin(request);
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { id } = await context.params;
    const body = z.object({ action: z.enum(["sync", "cancel"]) }).strict().safeParse(await request.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !body.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    await getOwnedPayPalSubscription(id, access.user.id);
    const result = body.data.action === "cancel" ? await cancelOwnedPayPalSubscription(id, access.user.id) : await syncPayPalSubscription(id);
    return NextResponse.json({ subscription: publicPayPalSubscription(result) });
  } catch (error) { return paypalErrorResponse(error); }
}
