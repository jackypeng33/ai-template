"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/button";
import type { PackKey } from "@/constants/billing";

export function PayPalPackButton({ packKey, className }: { packKey: PackKey; className?: string }) {
  const t = useTranslations("paypal");
  const locale = useLocale();
  const router = useRouter();
  const session = useSession();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const attempt = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/payments/paypal/config", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setEnabled(data?.enabled === true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function checkout() {
    const userId = session.data?.user?.id;
    if (!userId) { router.push(`${locale === "zh" ? "/zh" : ""}/login`); return; }
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const storageKey = `paypal-checkout:${userId}:${packKey}`;
      if (!attempt.current) {
        try { attempt.current = sessionStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
        attempt.current ??= crypto.randomUUID();
        try { sessionStorage.setItem(storageKey, attempt.current); } catch { /* The in-memory retry key still works. */ }
      }
      const response = await fetch("/api/payments/paypal/checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: packKey, requestId: attempt.current, locale }),
      });
      if (response.status === 401) { router.push(`${locale === "zh" ? "/zh" : ""}/login`); return; }
      if (!response.ok) throw new Error("CHECKOUT_FAILED");
      const data = await response.json() as { url: string };
      window.location.assign(data.url);
    } catch { setError(true); }
    finally { busy.current = false; setLoading(false); }
  }

  if (!enabled) return null;
  return (
    <div className={className}>
      <Button variant="outline" className="w-full disabled:opacity-50" onClick={checkout} disabled={loading || session.isPending}>
        {loading ? t("opening") : t("buy")}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{t("error")}</p>}
    </div>
  );
}
