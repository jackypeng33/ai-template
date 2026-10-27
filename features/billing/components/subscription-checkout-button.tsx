"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { useSession } from "@/lib/auth-client";
import type { PlanKey } from "@/constants/billing";

type Config = { subscriptionsEnabled: boolean; subscriptionPlans: string[] };
export function SubscriptionCheckoutButton({ planKey, onCreem, className, children }: {
  planKey: PlanKey; onCreem: () => void | Promise<void>; className?: string; children: ReactNode;
}) {
  const t = useTranslations("paypalSubscription");
  const locale = useLocale();
  const router = useRouter();
  const session = useSession();
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/payments/paypal/config", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(data => { if (!controller.signal.aborted) setConfig(data); }).catch(() => {});
    return () => controller.abort();
  }, []);
  async function checkout() {
    if (!config || inFlight.current) return;
    if (!config.subscriptionsEnabled) {
      inFlight.current = true; setBusy(true); setError(null);
      try { await onCreem(); }
      catch (failure) { setError(failure instanceof Error && failure.message === "SUBSCRIPTION_ALREADY_EXISTS" ? "alreadyExists" : "error"); }
      finally { inFlight.current = false; setBusy(false); }
      return;
    }
    const userId = session.data?.user?.id;
    if (!userId) { router.push(`${locale === "zh" ? "/zh" : ""}/login`); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const storageKey = `paypal-subscribe:${userId}:${planKey}`;
      let requestId: string | null = null;
      try { requestId = sessionStorage.getItem(storageKey); } catch { /* Optional browser storage. */ }
      requestId ||= crypto.randomUUID();
      try { sessionStorage.setItem(storageKey, requestId); } catch { /* Retry still remains safe on the server. */ }
      const response = await fetch("/api/payments/paypal/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: planKey, requestId, locale }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        if (data.error === "SUBSCRIPTION_ALREADY_EXISTS") { setError("alreadyExists"); return; }
        if (data.error === "SUBSCRIPTION_FINISHED") {
          try { sessionStorage.removeItem(storageKey); } catch { /* Optional. */ }
        }
        throw new Error("CHECKOUT_FAILED");
      }
      window.location.assign(data.url);
    } catch { setError("error"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const unavailable = config?.subscriptionsEnabled && !config.subscriptionPlans?.includes(planKey);
  return <div>
    <Button className={className} onClick={checkout} disabled={!config || busy || Boolean(unavailable)}>
      {busy ? t("opening") : unavailable ? t("unavailable") : config?.subscriptionsEnabled ? t("subscribe") : children}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{t(error)} <a className="underline" href={`${locale === "zh" ? "/zh" : ""}/settings#billing`}>{t("manage")}</a></p>}
  </div>;
}
