import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RapLanding } from "@/features/rap/rap-landing";
import { isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { isPayPalEnabled } from "@/lib/payments/paypal";
import { rapCheckoutReady } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "BOOTH — Two photos. One rap moment.",
  description: "Put you and your friend in the booth. Create an 8-second duo rap video from two photos. One video, one payment.",
  robots: { index: false, follow: false },
};
export default async function RapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (locale !== "en") redirect("/rap");
  return <RapLanding googleEnabled={isGoogleAuthEnabled()} initialCheckoutAvailable={rapCheckoutReady() && isPayPalEnabled()} />;
}
