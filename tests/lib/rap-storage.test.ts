// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ send: vi.fn(), signed: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  return { S3Client: class { send = mocks.send; destroy = mocks.destroy; },
    PutObjectCommand: Command, GetObjectCommand: Command, HeadObjectCommand: Command, DeleteObjectCommand: Command };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.signed }));
import { rapStorageReady, rapStorageConfig } from "@/lib/rap/r2-config";
import { getRapSignedUrl, getRapUploadUrl, putRapObject, objectExists, persistRapVideo } from "@/lib/rap/storage";
const key = "rap/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg";
describe("Rap private R2 boundaries", () => {
  beforeEach(() => {
    for (const k of ["RAP_STORAGE_BUCKET", "STORAGE_ENDPOINT", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) vi.stubEnv(k, "");
    mocks.send.mockReset(); mocks.signed.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());
  function configured() {
    vi.stubEnv("RAP_STORAGE_BUCKET", "private"); vi.stubEnv("STORAGE_ENDPOINT", "https://account.r2.cloudflarestorage.com");
    vi.stubEnv("STORAGE_ACCESS_KEY_ID", "test"); vi.stubEnv("STORAGE_SECRET_ACCESS_KEY", "test-secret");
  }
  it("never uses the starter public bucket for private media", () => {
    vi.stubEnv("STORAGE_BUCKET_NAME", "public");
    expect(rapStorageReady()).toBe(false);
  });
  it("supports R2 aliases while preferring existing private config", () => {
    vi.stubEnv("R2_ACCOUNT_ID", "alias"); vi.stubEnv("R2_BUCKET_NAME", "alias-private");
    vi.stubEnv("R2_ACCESS_KEY_ID", "alias-key"); vi.stubEnv("R2_SECRET_ACCESS_KEY", "alias-secret");
    expect(rapStorageConfig()).toMatchObject({ endpoint: "https://alias.r2.cloudflarestorage.com", bucket: "alias-private" });
    configured(); expect(rapStorageConfig()).toMatchObject({ bucket: "private", accessKeyId: "test" });
  });
  it("requires HTTPS storage endpoints and cannot sign local fallback files", async () => {
    await expect(getRapSignedUrl(key)).rejects.toThrow("PRIVATE_STORAGE_REQUIRED");
    configured(); vi.stubEnv("STORAGE_ENDPOINT", "http://localhost"); expect(rapStorageReady()).toBe(false);
  });
  it("only signs system keys and uses short PUT expiration", async () => {
    configured(); mocks.signed.mockResolvedValue("signed-test-url");
    await expect(getRapSignedUrl("../../other-user.jpg")).rejects.toThrow("INVALID_STORAGE_KEY");
    await expect(getRapSignedUrl(key, 999999)).rejects.toThrow("INVALID_SIGNATURE_TTL");
    await getRapUploadUrl(key, "image/jpeg");
    expect(mocks.signed.mock.calls[0][2]).toEqual({ expiresIn: 300 });
    await getRapSignedUrl(key); expect(mocks.signed.mock.calls[1][2]).toEqual({ expiresIn: 3600 });
  });
  it("does not accept an incomplete remote upload", async () => {
    configured(); mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: 2 });
    await expect(putRapObject(key, Buffer.from("test"), "image/jpeg")).rejects.toThrow("STORAGE_UPLOAD_INCOMPLETE");
  });
  it("streams bounded valid MP4 to R2 and verifies final length", async () => {
    configured();
    const ftyp = Buffer.alloc(16); ftyp.writeUInt32BE(16); ftyp.write("ftyp", 4);
    const moov = Buffer.alloc(40); moov.writeUInt32BE(40); moov.write("moov", 4);
    moov.writeUInt32BE(32, 8); moov.write("mvhd", 12);
    moov.writeUInt32BE(1000, 28); moov.writeUInt32BE(8000, 32);
    const video = Buffer.concat([ftyp, moov]);
    mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ ContentLength: video.length });
    const result = await persistRapVideo(new Response(video), key.replace(".jpg", ".mp4"));
    expect(result.mediaHash).toHaveLength(64);
    expect(mocks.send.mock.calls[0][0].input.ContentLength).toBe(video.length);
  });
  it("rejects invalid containers and oversized downloads before R2 upload", async () => {
    configured();
    await expect(persistRapVideo(new Response("invalid-video-bytes"), key)).rejects.toThrow("VIDEO_INVALID");
    await expect(persistRapVideo(new Response("x", { headers: { "content-length": String(101 * 1024 * 1024) } }), key)).rejects.toThrow("MEDIA_DOWNLOAD_FAILED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("only converts genuine missing files to false", async () => {
    configured(); mocks.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await objectExists(key)).toBe(false);
    mocks.send.mockRejectedValueOnce(new Error("network-error"));
    await expect(objectExists(key)).rejects.toThrow("network-error");
  });
});
