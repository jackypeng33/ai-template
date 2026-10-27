import { NextResponse } from "next/server";
import { isPayPalEnabled } from "@/lib/payments/paypal";
import { configuredPayPalPlans, payPalSubscriptionMode } from "@/lib/payments/paypal-subscription-api";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ enabled: isPayPalEnabled(), subscriptionsEnabled: payPalSubscriptionMode(),
    subscriptionPlans: configuredPayPalPlans() }, { headers: { "Cache-Control": "no-store" } });
}
