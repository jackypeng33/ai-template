import { z } from "zod";

export const MODERATION_POLICY_VERSION = "seeapi-strict-v1";
export type ModerationKind = "image" | "video";
export type ModerationVerdict = "approved" | "rejected" | "unresolved";
export const moderationIdentity = (kind: ModerationKind) => kind === "image"
  ? { model: "nsfw-filter", endpoint: "image-moderation", provider: "seeapi" }
  : { model: "video-nsfw-filter", endpoint: "video-moderation", provider: "seeapi" };

const labels = z.array(z.string());
const imageData = z.object({ flagged: z.boolean(), categories: z.object({ nsfw: labels, special_care: labels }) });
const frame = z.object({ frame_number: z.number().int().nonnegative(), timestamp_seconds: z.number().nonnegative(),
  nsfw_detected: z.boolean(), nsfw: labels, special: labels.optional() });
const videoData = z.object({ flagged: z.boolean(), output: z.object({
  nsfw_detected: z.boolean(), scope: z.literal("sampled_frames"), sampling_complete: z.boolean(),
  checked_frames: z.number().int().positive().max(32), flagged_frame_count: z.number().int().nonnegative(),
  timestamp_source: z.literal("frame_index_div_fps_estimate"), output_layout: z.literal("named-files-v1"),
  report_schema_version: z.literal(5), frames: z.array(frame).min(1).max(32),
}) });

// A successful inference is only an execution result. Unknown or contradictory reports never pass.
export function assessModeration(kind: ModerationKind, data: unknown): ModerationVerdict {
  if (typeof data === "object" && data !== null && ("flagged" in data && data.flagged === true || "reason" in data && data.reason === "content_policy_blocked")) return "rejected";
  if (kind === "image") {
    const parsed = imageData.safeParse(data);
    if (!parsed.success) return "unresolved";
    return parsed.data.categories.nsfw.length || parsed.data.categories.special_care.length ? "rejected" : "approved";
  }
  const parsed = videoData.safeParse(data);
  if (!parsed.success) return "unresolved";
  const o = parsed.data.output;
  if (o.nsfw_detected || o.frames.some(f => f.nsfw_detected || f.nsfw.length || f.special?.length)) return "rejected";
  if (!o.sampling_complete || o.checked_frames !== o.frames.length || o.flagged_frame_count !== 0 ||
    new Set(o.frames.map(f => f.frame_number)).size !== o.frames.length) return "unresolved";
  return "approved";
}
