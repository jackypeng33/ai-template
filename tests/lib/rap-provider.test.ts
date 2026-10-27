// @vitest-environment node
import { readFile } from "node:fs/promises";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { RAP_PRODUCT, rapCheckoutReady } from "@/lib/rap/config";
import { createKieTask, queryKieTask, uploadKieAsset, kiePayload } from "@/lib/rap/kie";
import { checkoutSchema, safeProviderUrl, readLimited, checkRapOrigin } from "@/lib/rap/validation";
import { normalizePortrait } from "@/lib/rap/repository";
vi.mock("@/lib/db", () => ({ db: {} }));

describe("BOOTH provider boundaries", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "false"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });
  it("never contacts KIE while generation is disabled, even with a key", async () => {
    vi.stubEnv("KIE_API_KEY", "not-a-real-key");
    await expect(createKieTask("left", "right", "audio")).rejects.toThrow("GENERATION_DISABLED");
    await expect(queryKieTask("task")).rejects.toThrow("GENERATION_DISABLED");
    await expect(uploadKieAsset(Buffer.from("x"), "asset.jpg", "image/jpeg")).rejects.toThrow("GENERATION_DISABLED");
    expect(fetchMock).not.toHaveBeenCalled(); expect(rapCheckoutReady()).toBe(false);
  });
  it("requires explicit launch approval instead of enabling checkout from credentials", () => {
    vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true"); vi.stubEnv("RAP_CHECKOUT_ENABLED", "true");
    vi.stubEnv("RAP_QUALITY_APPROVED", "false"); expect(rapCheckoutReady()).toBe(false);
  });
  it("fixes all purchased generation parameters and avoids arbitrary client prompts", () => {
    expect(kiePayload("left", "right", "audio")).toMatchObject({ model: "bytedance/seedance-2-mini", input: {
      duration: 8, resolution: "720p", aspect_ratio: "9:16", reference_image_urls: ["left", "right"], reference_audio_urls: ["audio"],
      generate_audio: true, web_search: false, nsfw_checker: true,
    } });
    expect(RAP_PRODUCT.priceCents).toBe(599);
  });
  it("binds task identity, distinguishes parse recovery from resubmission", async () => {
    vi.stubEnv("RAP_VIDEO_GENERATION_ENABLED", "true"); vi.stubEnv("KIE_API_KEY", "test");
    fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: { taskId: "another", model: RAP_PRODUCT.model, state: "success" } }));
    await expect(queryKieTask("mine")).rejects.toThrow("TASK_MISMATCH");
    fetchMock.mockResolvedValueOnce(Response.json({ code: 200, data: { taskId: "mine", model: RAP_PRODUCT.model, state: "success", resultJson: "broken" } }));
    await expect(queryKieTask("mine")).rejects.toThrow("RESULT_PENDING_REVIEW");
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("recordInfo"))).toBe(true);
  });
  it("rejects provider URL redirects/SSRF hosts and oversized streamed results", async () => {
    for (const url of ["http://tempfile.aiquickdraw.com/a", "https://127.0.0.1/a", "https://tempfile.aiquickdraw.com.evil.test/a", "https://tempfile.aiquickdraw.com:8080/a"]) expect(() => safeProviderUrl(url)).toThrow();
    await expect(readLimited(new Response(new Uint8Array(50)), 20)).rejects.toThrow("MEDIA_TOO_LARGE");
  });
  it("rejects arbitrary prices, URLs, models and cross-site mutation", () => {
    expect(checkoutSchema.safeParse({ requestId: crypto.randomUUID(), leftAssetId: crypto.randomUUID(), rightAssetId: crypto.randomUUID(), productKey: RAP_PRODUCT.key, priceCents: 1, model: "other" }).success).toBe(false);
    expect(() => checkRapOrigin(new Request("http://localhost:3000/api/rap/orders", { headers: { origin: "https://evil.test" } }))).toThrow("INVALID_ORIGIN");
  });
  it("actually decodes and normalizes supplied photos, rejects forged image bytes", async () => {
    const normalized = await normalizePortrait(await readFile("inputs/left.png"));
    expect(normalized.width).toBeGreaterThanOrEqual(300); expect(normalized.height).toBeLessThanOrEqual(1536);
    expect(normalized.data.subarray(0, 2).toString("hex")).toBe("ffd8");
    await expect(normalizePortrait(Buffer.from("not a photo, even if MIME says PNG"))).rejects.toThrow("PHOTO_INVALID");
  });
});
