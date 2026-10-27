import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processRapJobs, reconcileRapOrders, sendRapNotifications, cleanupRapMedia } from "@/lib/rap/worker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const incoming = Buffer.from(request.headers.get("authorization") || ""); const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const started = Date.now();
  const cleaned = await cleanupRapMedia();
  // A preparation can involve three uploads. Keep each invocation bounded;
  // unprocessed durable rows stay eligible for the following scheduled call.
  const jobs = await processRapJobs(1);
  const orders = Date.now() - started < 120_000 ? await reconcileRapOrders(1) : 0;
  const notifications = Date.now() - started < 230_000 ? await sendRapNotifications() : 0;
  return NextResponse.json({ orders, ...jobs, notifications, cleaned }, { headers: { "Cache-Control": "no-store" } });
}
