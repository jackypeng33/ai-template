"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/button";
import { getSubscriptionPlanTranslationKey } from "@/lib/account-settings";

type Summary = {
  id: string; planKey: string; status: string; paidThrough: string | null;
  nextBillingAt: string | null; reviewRequired: boolean; approvalUrl: string | null;
};
export function PayPalSubscriptions({ initialId, cancelled = false }: { initialId?: string; cancelled?: boolean }) {
  const t = useTranslations("paypalSubscription");
  const tDashboard = useTranslations("dashboard");
  const locale = useLocale();
  const session = useSession();
  const userId = session.data?.user?.id;
  const [rows, setRows] = useState<Summary[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/payments/paypal/subscriptions", { cache: "no-store", signal });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const data = await response.json() as { subscriptions: Summary[] };
    if (!signal?.aborted) setRows(data.subscriptions);
    return data.subscriptions;
  }, []);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function check(first: boolean) {
      try {
        if (first && initialId && !cancelled) {
          const response = await fetch(`/api/payments/paypal/subscriptions/${encodeURIComponent(initialId)}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }), signal: controller.signal,
          });
          if (!response.ok && !controller.signal.aborted) setError(true);
        }
        const items = await load(controller.signal);
        const target = items.find(row => row.id === initialId);
        if (target?.paidThrough || ["canceled", "expired"].includes(target?.status || "")) {
          if (target) { try { sessionStorage.removeItem(`paypal-subscribe:${userId}:${target.planKey}`); } catch { /* Optional. */ } }
        }
        if (initialId && !cancelled && !target?.paidThrough && !target?.reviewRequired && ++polls < 20 && !controller.signal.aborted) {
          timer = setTimeout(() => { void check(false); }, 3000);
        }
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void check(true);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [load, userId, initialId, cancelled]);
  async function act(id: string, action: "cancel" | "sync") {
    setBusy(true); setError(false);
    try {
      const response = await fetch(`/api/payments/paypal/subscriptions/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("SUBSCRIPTION_ACTION_FAILED");
      setConfirmId(null);
      await load();
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  function date(value: string | null) { return value ? new Date(value).toLocaleString(locale) : t("none"); }
  if (!initialId && !rows.length && !error) return null;
  return <section className="mt-6 space-y-4" aria-live="polite">
    <h2 className="text-xl font-semibold">{t("title")}</h2>
    {cancelled && <p className="text-sm text-muted-foreground">{t("approvalCancelled")}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{t("error")}</p>}
    {initialId && !rows.length && <p>{t("waiting")}</p>}
    {rows.map(row => <article key={row.id} className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="font-medium">{tDashboard(`cards.statistics.plans.${getSubscriptionPlanTranslationKey(row.planKey)}`)}</h3>
      <p>{t("status")}: {t(`statuses.${["approval_pending", "approved", "active", "suspended", "canceled", "expired"].includes(row.status) ? row.status : "needs_review"}`)}</p>
      {row.reviewRequired && <p className="text-sm text-red-600">{t("review")}</p>}
      <p>{t("paidThrough")}: {date(row.paidThrough)}</p>
      {["active", "approved"].includes(row.status) && <p>{t("nextBilling")}: {date(row.nextBillingAt)}</p>}
      {!row.paidThrough && !["canceled", "expired"].includes(row.status) && <p className="text-sm text-muted-foreground">{t("waiting")}</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy} onClick={() => { void act(row.id, "sync"); }}>{t("refresh")}</Button>
        {row.approvalUrl && <Button as="a" href={row.approvalUrl} variant="outline">{t("resume")}</Button>}
        {!["canceled", "expired"].includes(row.status) && <Button variant="outline" disabled={busy} onClick={() => setConfirmId(row.id)}>{t("cancel")}</Button>}
      </div>
      {confirmId === row.id && <div className="space-y-3 rounded-xl bg-muted p-4">
        <p>{t("cancelExplanation")}</p>
        <div className="flex gap-3">
          <Button disabled={busy} onClick={() => { void act(row.id, "cancel"); }}>{t("confirmCancel")}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setConfirmId(null)}>{t("keep")}</Button>
        </div>
      </div>}
    </article>)}
  </section>;
}
