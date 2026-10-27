import "server-only";
import { z } from "zod";
import { RAP_PRODUCT, RapError, rapGenerationEnabled, rapPrompt } from "./config";
import { safeProviderUrl } from "./validation";

function headers() {
  // This guard covers uploads, submission AND queries. No KIE calls while OFF.
  if (!rapGenerationEnabled()) throw new RapError(503, "GENERATION_DISABLED");
  if (!process.env.KIE_API_KEY) throw new RapError(503, "KIE_NOT_CONFIGURED");
  return { Authorization: `Bearer ${process.env.KIE_API_KEY}` };
}
export async function uploadKieAsset(bytes: Buffer, filename: string, type: string) {
  const auth = headers(); const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type }), filename);
  form.set("uploadPath", "booth/rap"); form.set("fileName", filename);
  const response = await fetch("https://kieai.redpandaai.co/api/file-stream-upload", {
    method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(60_000), cache: "no-store",
  });
  if (!response.ok) throw new RapError(502, "ASSET_UPLOAD_FAILED");
  const data = z.object({ code: z.literal(200), success: z.literal(true), data: z.object({ downloadUrl: z.string().url() }) }).parse(await response.json());
  return safeProviderUrl(data.data.downloadUrl);
}
export function kiePayload(left: string, right: string, audio: string) {
  return { model: RAP_PRODUCT.model, input: {
    reference_image_urls: [left, right], reference_audio_urls: [audio], prompt: rapPrompt,
    duration: RAP_PRODUCT.duration, resolution: RAP_PRODUCT.resolution, aspect_ratio: RAP_PRODUCT.aspectRatio,
    generate_audio: true, web_search: false, nsfw_checker: true,
  } };
}
export async function createKieTask(left: string, right: string, audio: string) {
  // Any uncertain response is handled as submission_unknown by the worker.
  const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(kiePayload(left, right, audio)), signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
  if (!response.ok) throw new RapError(502, "SUBMISSION_UNKNOWN");
  const value = z.object({ code: z.number(), data: z.object({ taskId: z.string().min(1).max(128) }).optional() }).parse(await response.json());
  if (value.code !== 200 || !value.data) throw new RapError(502, "SUBMISSION_UNKNOWN");
  return value.data.taskId;
}
export async function queryKieTask(taskId: string) {
  const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: headers(), signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) throw new RapError(502, "STATUS_UNAVAILABLE");
  const parsed = z.object({ code: z.literal(200), data: z.object({
    taskId: z.string(), model: z.string(), state: z.enum(["waiting", "queuing", "generating", "success", "fail"]),
    resultJson: z.union([z.string(), z.object({ resultUrls: z.array(z.string()) })]).nullish(),
    creditsConsumed: z.number().nonnegative().nullish(),
  }) }).parse(await response.json());
  if (parsed.data.taskId !== taskId || parsed.data.model !== RAP_PRODUCT.model) throw new RapError(502, "TASK_MISMATCH");
  let resultUrl: string | undefined;
  if (parsed.data.state === "success") {
    try {
      const result = typeof parsed.data.resultJson === "string" ? JSON.parse(parsed.data.resultJson) : parsed.data.resultJson;
      resultUrl = safeProviderUrl(z.object({ resultUrls: z.array(z.string()).min(1) }).parse(result).resultUrls[0]);
    } catch { throw new RapError(502, "RESULT_PENDING_REVIEW"); }
  }
  return { state: parsed.data.state, resultUrl, creditsConsumed: parsed.data.creditsConsumed ?? null };
}
