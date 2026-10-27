import { NextResponse } from "next/server";
import { paypalEventSchema } from "@/lib/payments/paypal-webhook";
import { verifyPayPalWebhook } from "@/lib/payments/paypal";
import { processRapWebhook } from "@/lib/rap/payments";
import { rapErrorResponse } from "@/lib/rap/http";
import { RapError } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const event = await request.json();
    if (!process.env.RAP_PAYPAL_WEBHOOK_ID) throw new RapError(503, "RAP_WEBHOOK_NOT_CONFIGURED");
    if (!await verifyPayPalWebhook(request.headers, event, process.env.RAP_PAYPAL_WEBHOOK_ID)) throw new RapError(401, "INVALID_SIGNATURE");
    await processRapWebhook(paypalEventSchema.parse(event)); return NextResponse.json({ received: true });
  } catch (error) { return rapErrorResponse(error); }
}
