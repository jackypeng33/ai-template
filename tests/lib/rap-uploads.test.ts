// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ intent: null as Record<string, unknown> | null,
  head: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), access: vi.fn(),
  insert: vi.fn(), where: vi.fn(), values: vi.fn(), returning: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ where: async () => mocks.intent ? [mocks.intent] : [] }) }),
  update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "upload" }], then: (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve) }) }) }),
} }));
vi.mock("@/lib/rap/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rap/http")>("@/lib/rap/http");
  return { ...actual, rapAccess: mocks.access };
});
vi.mock("@/lib/rap/storage", () => ({ headRapObject: mocks.head, getRapObject: mocks.read, deleteRapObject: mocks.remove }));
vi.mock("@/lib/rap/repository", () => ({ savePortrait: mocks.save }));
import { POST } from "@/app/api/rap/uploads/[id]/complete/route";
const request = () => new Request("http://localhost:3000/api/rap/uploads/upload/complete", { method: "POST" });
const context = { params: Promise.resolve({ id: "upload" }) };
describe("R2 upload confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.access.mockResolvedValue({ id: "user" });
    mocks.intent = { id: "upload", userId: "user", storageKey: "temp/test/test.jpg", contentType: "image/jpeg", size: 4,
      status: "pending", expiresAt: new Date(Date.now() + 100000) };
  });
  it("does not read or save an unowned upload", async () => {
    mocks.intent = null;
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("deletes invalid object metadata without creating an asset", async () => {
    mocks.head.mockResolvedValue({ size: 100, contentType: "image/jpeg" });
    const response = await POST(request(), context);
    expect(response.status).toBe(400); expect(mocks.remove).toHaveBeenCalledWith("temp/test/test.jpg");
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("normalizes downloaded bytes rather than approving a temporary PUT key", async () => {
    mocks.head.mockResolvedValue({ size: 4, contentType: "image/jpeg" });
    mocks.read.mockResolvedValue(Buffer.from("test")); mocks.save.mockResolvedValue({ assetId: "new-immutable-asset" });
    const response = await POST(request(), context);
    expect(response.status).toBe(201); expect(mocks.save).toHaveBeenCalledWith("user", Buffer.from("test"));
    expect(await response.json()).toEqual({ assetId: "new-immutable-asset" });
  });
  it("rejects data that changed length between HEAD and GET", async () => {
    mocks.head.mockResolvedValue({ size: 4, contentType: "image/jpeg" }); mocks.read.mockResolvedValue(Buffer.from("longer"));
    expect((await POST(request(), context)).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  });
});
