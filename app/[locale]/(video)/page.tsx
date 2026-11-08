import { redirect } from "next/navigation";
import { RapLanding } from "@/features/rap/rap-landing";
import { isGitHubAuthEnabled } from "@/lib/auth/github-auth";
import { isGoogleAuthEnabled } from "@/lib/auth/google-auth";
import { isPayPalEnabled } from "@/lib/payments/paypal";
import { rapCheckoutReady } from "@/lib/rap/config";
import { rapHomeMetadata } from "@/lib/rap/metadata";

export const dynamic = "force-dynamic";
export const metadata = rapHomeMetadata;

export default async function VideoHome({ params }: { params: Promise<{ locale: string }> }) {
  if ((await params).locale !== "en") redirect("/");
  return <RapLanding googleEnabled={isGoogleAuthEnabled()} githubEnabled={isGitHubAuthEnabled()} initialCheckoutAvailable={rapCheckoutReady() && isPayPalEnabled()} />;
}
