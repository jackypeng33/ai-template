"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Feedback = { id: string; orderId: string; request: string; message: string; status: string; resolution: string | null };
type Snapshot = { feedback: Feedback[]; orders: { id: string; status: string; retryCredits: number }[];
  tasks: { id: string; orderId: string; status: string; error: string | null; providerTaskId: string | null }[]; counts: { kind: string; count: number }[] };
export function RapManager() {
  const [data, setData] = useState<Snapshot | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function refresh() { const response = await fetch("/api/rap/manage", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  async function resolve(event: React.FormEvent<HTMLFormElement>, feedbackId: string) {
    event.preventDefault(); setError(""); setBusy(true); const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rap/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedbackId,
        action: form.get("action"), note: form.get("note"), ...(form.get("refundId") ? { refundId: form.get("refundId") } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-5xl space-y-7 p-6"><Link href="/rap" className="underline">← BOOTH</Link><h1 className="text-3xl font-bold">BOOTH operations</h1>
    <p>Latest 100 orders / 200 tasks. Reconcile refund/reversal notifications before resuming an order. Verify unknown submissions in the provider dashboard; never resubmit them blindly.</p>
    {error && <p role="alert" className="rounded border border-red-500 p-3">{error}</p>}<button className="rounded border px-4 py-2" onClick={() => void refresh().catch(e => setError(e.message))}>Refresh</button>
    <section><h2 className="text-xl font-semibold">Recorded events</h2><ul>{data?.counts.map(c => <li key={c.kind}>{c.kind}: {c.count}</li>)}</ul></section>
    <section className="space-y-4"><h2 className="text-xl font-semibold">Support requests</h2>{data?.feedback.map(item => <article key={item.id} className="space-y-3 rounded border p-4"><strong>{item.orderId} · {item.request} · {item.status}</strong><p className="whitespace-pre-wrap">{item.message}</p>{item.status === "open" ? <form className="flex flex-wrap gap-3" onSubmit={e => void resolve(e, item.id)}><select className="rounded border bg-background p-2" name="action" aria-label="Resolution"><option value="resolved">Resolve without compensation</option><option value="replacement">Grant one replacement</option><option value="refund_recorded">Record verified full PayPal refund</option></select><input className="rounded border bg-background p-2" name="refundId" placeholder="PayPal refund ID, if refunded" aria-label="PayPal refund ID" /><input className="min-w-64 rounded border bg-background p-2" name="note" aria-label="Resolution note" minLength={5} maxLength={1000} placeholder="Decision and reason" required /><button disabled={busy} className="rounded border px-3 py-2">Save decision</button></form> : <p>{item.resolution}</p>}</article>)}</section>
    <section><h2 className="text-xl font-semibold">Tasks requiring attention</h2>{data?.tasks.filter(t => ["requires_review", "submission_unknown"].includes(t.status)).map(t => <article key={t.id} className="my-3 rounded border p-3"><p>{t.orderId}</p><p>{t.status} · {t.error}</p><p>Provider task: {t.providerTaskId || "Unknown — investigate original submission"}</p></article>)}</section>
  </main>;
}
