import { PayPalSubscriptions } from "@/features/billing/components/paypal-subscriptions";
import { notFound } from "next/navigation";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function SubscriptionReturnPage({ searchParams }: {
  searchParams: Promise<{ id?: string; cancelled?: string }>;
}) {
  const params = await searchParams;
  if (!z.string().uuid().safeParse(params.id).success) notFound();
  return <div className="mx-auto max-w-2xl px-6 py-20"><PayPalSubscriptions initialId={params.id || ""} cancelled={params.cancelled === "1"} /></div>;
}
