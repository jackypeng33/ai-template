import { NextResponse } from "next/server";
import { RAP_PRODUCT, rapCheckoutReady } from "@/lib/rap/config";
import { isPayPalEnabled } from "@/lib/payments/paypal";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ product: RAP_PRODUCT, checkoutAvailable: rapCheckoutReady() && isPayPalEnabled(),
    supportEmail: process.env.RAP_SUPPORT_EMAIL || null }, { headers: { "Cache-Control": "no-store" } });
}
