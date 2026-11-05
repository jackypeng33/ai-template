// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), select: vi.fn(), update: vi.fn(), head: vi.fn(),
  get: vi.fn(), remove: vi.fn(), save: vi.fn(), ready: vi.fn(), sign: vi.fn(), transaction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getActiveSessionUser: mocks.access }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select, update: mocks.update, transaction: mocks.transaction } }));
vi.mock("@/lib/rap/storage", () => ({ getRapUploadUrl: mocks.sign, rapStorageReady: mocks.ready,
  headRapObject: mocks.head, getRapObject: mocks.get, deleteRapObject: mocks.remove }));
vi.mock("@/lib/rap/repository", () => ({ savePortrait: mocks.save }));
import { POST as createUpload } from "@/app/api/rap/uploads/route";
import { POST as confirmUpload } from "@/app/api/rap/uploads/[id]/complete/route";
const ctx = { params: Promise.resolve({ id: "upload-test" }) };
const request = (body = {}) => new Request("http://localhost:3000/api/rap/uploads", { method: "POST",
  headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body) });
const intent = { id: "upload-test", userId: "buyer", storageKey: "temp/test/raw.png", size: 5,
  contentType: "image/png", status: "pending", expiresAt: new Date(Date.now() + 3600000) };
function selected(...rows: unknown[][]) {
  for (const result of rows) mocks.select.mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve(result) }) });
}
describe("Rap direct upload HTTP boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReset(); mocks.update.mockReset();
    mocks.access.mockResolvedValue({ ok: true, user: { id: "buyer", role: "user" } });
    mocks.ready.mockReturnValue(true);
    mocks.update.mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([intent]), then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve) }) }) });
  });
  it("rejects anonymous upload before creating a signed URL", async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 401, error: "Unauthorized" });
    expect((await createUpload(request({ contentType: "image/png", size: 5 }))).status).toBe(401);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each([{ contentType: "video/mp4", size: 5 }, { contentType: "image/png", size: 11 * 1024 * 1024 }])("rejects unsupported upload metadata %j before signing", async body => {
    expect((await createUpload(request(body))).status).toBe(400);
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects cross-origin confirmation before reading storage", async () => {
    const req = new Request("http://localhost:3000/api/rap/uploads/x/complete", { method: "POST", headers: { Origin: "https://attacker.invalid" } });
    expect((await confirmUpload(req, ctx)).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.head).not.toHaveBeenCalled();
  });
  it("cannot confirm an upload missing from the user's owned records", async () => {
    selected([]);
    expect((await confirmUpload(request(), ctx)).status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("deletes oversized raw objects before decoding or creating an asset", async () => {
    selected([intent]); mocks.head.mockResolvedValue({ size: 20 * 1024 * 1024, contentType: "image/png" });
    expect((await confirmUpload(request(), ctx)).status).toBe(400);
    expect(mocks.remove).toHaveBeenCalledWith(intent.storageKey);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects actual bytes that differ in size from declared metadata", async () => {
    selected([intent]); mocks.head.mockResolvedValue({ size: 5, contentType: "image/png" });
    mocks.get.mockResolvedValue(Buffer.from("oversized"));
    expect((await confirmUpload(request(), ctx)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("normalizes actual bytes into a separate business asset", async () => {
    selected([intent]); mocks.head.mockResolvedValue({ size: 5, contentType: "image/png" });
    mocks.get.mockResolvedValue(Buffer.from("photo")); mocks.save.mockResolvedValue({ assetId: "normalized-id", moderationStatus: "pending" });
    const response = await confirmUpload(request(), ctx);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ assetId: "normalized-id", moderationStatus: "pending" });
    expect(mocks.save).toHaveBeenCalledWith("buyer", Buffer.from("photo"));
  });
  it("returns the existing asset on repeated confirmation without reading mutable raw bytes", async () => {
    selected([{ ...intent, status: "completed", assetId: "normalized-id" }], [{ id: "normalized-id", userId: "buyer", storageKey: "rap/immutable.jpg", expiresAt: new Date(Date.now() + 3600000) }]);
    expect((await confirmUpload(request(), ctx)).status).toBe(200);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
});
