import { z } from "zod";
import { RAP_PRODUCT, RapError } from "./config";

export const checkoutSchema = z.object({
  requestId: z.uuid(), leftAssetId: z.uuid(), rightAssetId: z.uuid(),
  priceCents: z.literal(RAP_PRODUCT.priceCents), productKey: z.literal(RAP_PRODUCT.key),
}).strict();
export const retrySchema = z.object({ requestId: z.uuid(), leftAssetId: z.uuid(), rightAssetId: z.uuid() }).strict();
export const feedbackSchema = z.object({
  message: z.string().trim().min(10).max(2000), request: z.enum(["help", "replacement", "refund"]),
}).strict();
export const resolutionSchema = z.object({
  action: z.enum(["replacement", "refund_recorded", "resolved"]), note: z.string().trim().min(5).max(1000),
  refundId: z.string().min(1).max(128).optional(),
}).strict();

export function checkRapOrigin(request: Request) {
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
  const origin = request.headers.get("origin");
  if ((origin && origin !== expected) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RapError(403, "INVALID_ORIGIN");
  }
}

export function safeProviderUrl(value: string) {
  const url = new URL(value);
  const hosts = ["tempfile.aiquickdraw.com", "tempfile.redpandaai.co", "tempfile.kie.ai"];
  if (url.protocol !== "https:" || url.port || url.username || url.password || !hosts.includes(url.hostname)) {
    throw new RapError(502, "PROVIDER_URL_NOT_ALLOWED");
  }
  return url.toString();
}

export async function readLimited(response: Response, maxBytes: number) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > maxBytes) {
    throw new RapError(502, "MEDIA_DOWNLOAD_FAILED");
  }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) throw new RapError(413, "MEDIA_TOO_LARGE");
      parts.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(parts);
}
