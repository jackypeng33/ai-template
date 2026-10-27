import { NextRequest, NextResponse } from "next/server";
import { verifyPayPalWebhook } from "@/lib/payments/paypal";
import { paypalEventSchema, processPayPalWebhook } from "@/lib/payments/paypal-webhook";
import { paypalErrorResponse } from "@/lib/payments/paypal-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256 * 1024) return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let event: unknown;
    try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 }); }
    if (!await verifyPayPalWebhook(request.headers, event)) return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 400 });
    const parsed = paypalEventSchema.safeParse(event);
    if (!parsed.success) return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
    await processPayPalWebhook(parsed.data);
    return NextResponse.json({ received: true });
  } catch (error) { return paypalErrorResponse(error); }
}
