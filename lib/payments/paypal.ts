import { z } from "zod";

export class PayPalError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export function getPayPalConfig(): {
  environment: "sandbox" | "live"; clientId: string; secret: string;
  webhookId: string; merchantId: string; baseUrl: string;
} {
  const environment = process.env.PAYPAL_ENV || "sandbox";
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  const merchantId = process.env.PAYPAL_MERCHANT_ID?.trim();
  if (process.env.PAYPAL_ENABLED !== "true" || !clientId || !secret || !webhookId || !merchantId ||
    (environment !== "sandbox" && environment !== "live")) {
    throw new PayPalError(503, "PAYPAL_NOT_CONFIGURED");
  }
  return {
    environment, clientId, secret, webhookId, merchantId,
    baseUrl: environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

export function isPayPalEnabled() {
  try { getPayPalConfig(); return true; } catch { return false; }
}

const amountSchema = z.object({ currency_code: z.string(), value: z.string() });
export const paypalCaptureSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: amountSchema,
  custom_id: z.string().optional(),
  payee: z.object({ merchant_id: z.string().optional() }).optional(),
  supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).optional() }).optional(),
});
export type PayPalCapture = z.infer<typeof paypalCaptureSchema>;
export const paypalOrderSchema = z.object({
  id: z.string().min(1), status: z.string(), intent: z.string(),
  purchase_units: z.array(z.object({
    reference_id: z.string().optional(), custom_id: z.string().optional(),
    amount: amountSchema,
    payee: z.object({ merchant_id: z.string().optional() }).optional(),
    payments: z.object({ captures: z.array(paypalCaptureSchema).optional() }).optional(),
  })),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
export type PayPalOrder = z.infer<typeof paypalOrderSchema>;
const orderSummarySchema = paypalOrderSchema.pick({ id: true, status: true, links: true });

let cachedToken: { key: string; value: string; expires: number } | undefined;
async function getAccessToken() {
  const config = getPayPalConfig();
  const key = `${config.environment}:${config.clientId}:${config.secret}`;
  if (cachedToken?.key === key && cachedToken.expires > Date.now()) return cachedToken.value;
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new PayPalError(502, "PAYPAL_AUTH_FAILED");
  const data = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
  cachedToken = { key, value: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
  return data.access_token;
}

export async function paypalRequest(path: string, method = "GET", body?: unknown, requestId?: string): Promise<unknown> {
  const config = getPayPalConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method, cache: "no-store", signal: AbortSignal.timeout(25_000),
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // Do not leak provider responses, credentials, or buyer data to clients/logs.
    throw new PayPalError(502, "PAYPAL_REQUEST_FAILED");
  }
  return response.status === 204 ? null : response.json();
}

export function getPayPalReturnUrl(orderId: string, locale: string, cancelled = false) {
  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  if (!['http:', 'https:'].includes(appUrl.protocol) ||
      (getPayPalConfig().environment === "live" && appUrl.protocol !== "https:")) {
    throw new PayPalError(503, "PAYPAL_INVALID_APP_URL");
  }
  const url = new URL(`${locale === "zh" ? "/zh" : ""}/billing/return`, appUrl.origin);
  url.searchParams.set("orderId", orderId);
  if (cancelled) url.searchParams.set("cancelled", "1");
  return url.toString();
}

export async function createPayPalOrder(order: {
  id: string; amountCents: number; currency: string; merchantId: string; locale: string;
}) {
  return orderSummarySchema.parse(await paypalRequest("/v2/checkout/orders", "POST", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: order.id, custom_id: order.id,
      amount: { currency_code: order.currency.toUpperCase(), value: (order.amountCents / 100).toFixed(2) },
      payee: { merchant_id: order.merchantId },
    }],
    payment_source: { paypal: { experience_context: {
      shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
      return_url: getPayPalReturnUrl(order.id, order.locale),
      cancel_url: getPayPalReturnUrl(order.id, order.locale, true),
    } } },
  }, `create-${order.id}`));
}

export async function getPayPalOrder(id: string) {
  return paypalOrderSchema.parse(await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(id)}`));
}
export async function capturePayPalOrder(id: string, localOrderId: string) {
  return orderSummarySchema.parse(await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, "POST", {}, `capture-${localOrderId}`));
}
export async function getPayPalCapture(id: string) {
  return paypalCaptureSchema.parse(await paypalRequest(`/v2/payments/captures/${encodeURIComponent(id)}`));
}

export async function verifyPayPalWebhook(headers: Headers, event: unknown, webhookId?: string) {
  const fields = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (fields.some(field => !headers.get(field))) return false;
  const result = await paypalRequest("/v1/notifications/verify-webhook-signature", "POST", {
    auth_algo: headers.get(fields[0]), cert_url: headers.get(fields[1]),
    transmission_id: headers.get(fields[2]), transmission_sig: headers.get(fields[3]),
    transmission_time: headers.get(fields[4]), webhook_id: webhookId || getPayPalConfig().webhookId,
    webhook_event: event,
  });
  return z.object({ verification_status: z.string() }).parse(result).verification_status === "SUCCESS";
}
