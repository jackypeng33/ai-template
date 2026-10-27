import { PayPalReturn } from "@/features/billing/components/paypal-return";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function PaymentReturnPage({ searchParams }: {
  searchParams: Promise<{ orderId?: string; cancelled?: string }>;
}) {
  const params = await searchParams;
  return <PayPalReturn orderId={params.orderId || ""} cancelled={params.cancelled === "1"} />;
}
