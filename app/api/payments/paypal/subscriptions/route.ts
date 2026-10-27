import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscription } from "@/lib/db/schema";
import { getActiveSessionUser } from "@/lib/auth/session";
import { checkPaymentOrigin, paypalErrorResponse } from "@/lib/payments/paypal-http";
import { publicPayPalSubscription, startPayPalSubscription } from "@/lib/payments/paypal-subscriptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ key: z.string().max(64), requestId: z.string().uuid(), locale: z.enum(["en", "zh"]) }).strict();
export async function POST(request: NextRequest) {
  try {
    checkPaymentOrigin(request);
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return NextResponse.json(await startPayPalSubscription(access.user.id, body.data.key, body.data.requestId, body.data.locale));
  } catch (error) { return paypalErrorResponse(error); }
}
export async function GET(request: NextRequest) {
  try {
    const access = await getActiveSessionUser(request.headers);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const rows = await db.select().from(subscription).where(and(
      eq(subscription.userId, access.user.id), eq(subscription.provider, "paypal"),
    )).orderBy(desc(subscription.createdAt)).limit(50);
    return NextResponse.json({ subscriptions: rows.map(publicPayPalSubscription) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return paypalErrorResponse(error); }
}
