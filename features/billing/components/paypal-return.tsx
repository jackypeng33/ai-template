"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/button";

type Result = { id: string; status: string; credits: number; packKey: string };
type View = "checking" | "succeeded" | "pending" | "cancelled" | "failed" | "error" | "review";

export function PayPalReturn({ orderId, cancelled }: { orderId: string; cancelled: boolean }) {
  const t = useTranslations("paypal");
  const locale = useLocale();
  const session = useSession();
  const [view, setView] = useState<View>("checking");
  const [credits, setCredits] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const userId = session.data?.user?.id;

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    function clearAttempt(packKey: string) {
      try { sessionStorage.removeItem(`paypal-checkout:${userId}:${packKey}`); } catch { /* Optional browser storage. */ }
    }
    async function check(first: boolean) {
      try {
        const response = await fetch(first && !cancelled ? "/api/payments/paypal/capture" : `/api/payments/paypal/orders/${encodeURIComponent(orderId)}`, {
          ...(first && !cancelled ? {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }),
          } : {}),
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json() as { order?: Result; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !data.order) {
          setView(data.error === "ORDER_REQUIRES_REVIEW" ? "review" : "error");
          return;
        }
        const order = data.order;
        if (order.status === "succeeded") {
          clearAttempt(order.packKey);
          setCredits(order.credits);
          setView("succeeded");
        } else if (order.status === "failed") {
          clearAttempt(order.packKey);
          setView("failed");
        } else if (cancelled) {
          clearAttempt(order.packKey);
          setView("cancelled");
        } else {
          setView("pending");
          if (++count < 20) timer = setTimeout(() => { void check(false); }, 3000);
        }
      } catch {
        if (!controller.signal.aborted) setView("error");
      }
    }
    void check(true);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [orderId, cancelled, attempt, userId]);

  return (
    <section className="mx-auto max-w-xl px-6 py-24" aria-live="polite">
      <h1 className="text-3xl font-semibold">{t("title")}</h1>
      <p className="mt-6 text-muted-foreground">{t(view, { credits })}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {["error", "pending"].includes(view) && <Button onClick={() => { setView("checking"); setAttempt(value => value + 1); }}>{t("retry")}</Button>}
        <Button as={Link} href={`${locale === "zh" ? "/zh" : ""}/credits`} variant="outline">{t("viewCredits")}</Button>
      </div>
    </section>
  );
}
