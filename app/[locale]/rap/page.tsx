import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RapLanding } from "@/features/rap/rap-landing";
import { isGitHubAuthEnabled } from "@/lib/auth/github-auth";
import { isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { isPayPalEnabled } from "@/lib/payments/paypal";
import { rapCheckoutReady } from "@/lib/rap/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "RapVideoMaker — AI Rap Video Generator",
  description: "Put you and your friend in the booth. Create a 10-second duo rap video from two photos. One video, one payment.",
  robots: { index: false, follow: false },
};
export default async function RapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; if (locale !== "en") redirect("/rap");
  return <RapLanding googleEnabled={isGoogleAuthEnabled()} githubEnabled={isGitHubAuthEnabled()} initialCheckoutAvailable={rapCheckoutReady() && isPayPalEnabled()} />;
}
