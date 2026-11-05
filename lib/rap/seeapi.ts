import "server-only";
import { z } from "zod";
import { RapError } from "./config";
import { readLimited } from "./validation";
import { moderationIdentity, type ModerationKind } from "./moderation-policy";

export function rapModerationReady() {
  return process.env.RAP_MODERATION_ENABLED === "true" && Boolean(process.env.SEEAPI_API_KEY);
}
export function createModerationBody(kind: ModerationKind, url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new RapError(503, "MODERATION_SOURCE_INVALID");
  return JSON.stringify({ ...moderationIdentity(kind), input: kind === "image"
    ? { image_url: url, threshold_offset: 0, strict_special_care: true }
    : { video_url: url, threshold_offset: 0, strict_special_care: true, num_frames: 32, return_frames: "none" } });
}
const inference = z.object({ id: z.string().min(1).max(255), object: z.literal("inference"),
  model: z.string(), endpoint: z.string(), provider: z.literal("seeapi"),
  status: z.enum(["queued", "processing", "succeeded", "failed", "canceled", "cancelled"]),
  result: z.object({ type: z.literal("json"), data: z.unknown() }).nullable(),
  error: z.unknown().nullable(),
});
export type SeeApiInference = z.infer<typeof inference>;
async function request(path: string, kind: ModerationKind, body?: string, key?: string): Promise<SeeApiInference> {
  if (!rapModerationReady()) throw new RapError(503, "MODERATION_DISABLED");
  let response: Response;
  try {
    response = await fetch(`https://api.seeapi.com/v1/inferences${path}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.SEEAPI_API_KEY}`,
        ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key! } : {}) },
      ...(body ? { body } : {}), redirect: "error", signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
  } catch { throw new RapError(503, "MODERATION_NETWORK_ERROR"); }
  if (!response.ok) throw new RapError(response.status === 429 || response.status >= 500 ? 503 : 502, `MODERATION_HTTP_${response.status}`);
  try {
    const value = inference.parse(JSON.parse((await readLimited(response, 1024 * 1024)).toString("utf8")));
    const identity = moderationIdentity(kind);
    if (value.model !== identity.model || value.endpoint !== identity.endpoint) throw new Error("identity");
    return value;
  } catch { throw new RapError(502, "MODERATION_REPORT_INVALID"); }
}
export async function submitModeration(kind: ModerationKind, body: string, idempotencyKey: string) {
  return request("", kind, body, idempotencyKey);
}
export async function queryModeration(kind: ModerationKind, taskId: string) {
  const value = await request(`/${encodeURIComponent(taskId)}`, kind);
  if (value.id !== taskId) throw new RapError(502, "MODERATION_TASK_MISMATCH");
  return value;
}
