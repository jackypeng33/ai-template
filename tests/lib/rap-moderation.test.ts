// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assessModeration } from "@/lib/rap/moderation-policy";
import { createModerationBody, submitModeration, queryModeration } from "@/lib/rap/seeapi";

const clean = () => ({ flagged: false, output: { nsfw_detected: false, scope: "sampled_frames", sampling_complete: true,
  checked_frames: 1, flagged_frame_count: 0, timestamp_source: "frame_index_div_fps_estimate", output_layout: "named-files-v1", report_schema_version: 5,
  frames: [{ frame_number: 1, timestamp_seconds: 0, nsfw_detected: false, nsfw: [] as string[], special: [] }] } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Rap moderation decisions", () => {
  it("requires structured clean image results", () => {
    expect(assessModeration("image", { flagged: false, categories: { nsfw: [], special_care: [] } })).toBe("approved");
    for (const data of [null, {}, { flagged: false }, { flagged: false, categories: { nsfw: [] } }]) expect(assessModeration("image", data)).toBe("unresolved");
    expect(assessModeration("image", { flagged: false, categories: { nsfw: ["nudity"], special_care: [] } })).toBe("rejected");
  });
  it("rejects flagged and policy blocked outcomes even without frame reports", () => {
    expect(assessModeration("video", { flagged: true, output: null, reason: "content_policy_blocked" })).toBe("rejected");
    expect(assessModeration("video", { reason: "content_policy_blocked" })).toBe("rejected");
  });
  it("only accepts complete and consistent video reports", () => {
    expect(assessModeration("video", clean())).toBe("approved");
    const incomplete = clean(); incomplete.output.sampling_complete = false;
    expect(assessModeration("video", incomplete)).toBe("unresolved");
    const inconsistent = clean(); inconsistent.output.checked_frames = 2;
    expect(assessModeration("video", inconsistent)).toBe("unresolved");
    const unknown = clean(); unknown.output.report_schema_version = 6;
    expect(assessModeration("video", unknown)).toBe("unresolved");
    const flagged = clean(); flagged.output.frames[0].nsfw = ["nudity"];
    expect(assessModeration("video", flagged)).toBe("rejected");
  });
});
describe("SeeAPI request boundaries", () => {
  it("makes zero calls when disabled even with credentials", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SEEAPI_API_KEY", "test"); vi.stubEnv("RAP_MODERATION_ENABLED", "false");
    await expect(submitModeration("image", "{}", "key")).rejects.toThrow("MODERATION_DISABLED");
    await expect(queryModeration("video", "task")).rejects.toThrow("MODERATION_DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("binds returned task identity and preserves the exact body on retry", async () => {
    vi.stubEnv("SEEAPI_API_KEY", "test"); vi.stubEnv("RAP_MODERATION_ENABLED", "true");
    const response = { id: "task", object: "inference", model: "nsfw-filter", endpoint: "image-moderation", provider: "seeapi", status: "processing", result: null, error: null };
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(response)); vi.stubGlobal("fetch", fetchMock);
    const body = createModerationBody("image", "https://bucket.example/image?token=signed");
    await submitModeration("image", body, "unique"); await submitModeration("image", body, "unique");
    expect(fetchMock.mock.calls[0][1].body).toBe(body);
    expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe("unique");
    await expect(queryModeration("image", "different")).rejects.toThrow("MODERATION_TASK_MISMATCH");
  });
});
