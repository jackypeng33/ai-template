import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImgHTMLAttributes } from "react";
const auth = vi.hoisted(() => ({ signedIn: false, email: vi.fn(), signup: vi.fn(), refetch: vi.fn() }));
const draft = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: auth.signedIn ? { user: { email: "buyer@test.invalid" } } : null, refetch: auth.refetch }), signIn: { email: auth.email }, signUp: { email: auth.signup } }));
vi.mock("@/features/rap/draft", () => ({ readRapDraft: draft.read, writeRapDraft: draft.write, clearRapDraft: draft.clear }));
vi.mock("next/image", () => ({ default: ({ fill: _fill, unoptimized: _unoptimized, priority: _priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean }) => {
  void _fill; void _unoptimized; void _priority;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt} />;
} }));
import { RapLanding } from "@/features/rap/rap-landing";

describe("BOOTH customer flow", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    auth.signedIn = false; draft.read.mockResolvedValue(undefined); draft.write.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => Promise.resolve(Response.json(url.includes("config") ? { checkoutAvailable: false } : url.includes("orders") ? { orders: [] } : {})));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    window.history.replaceState({}, "", "/rap");
  });
  it("requires both photos before opening sign-in or any checkout", async () => {
    render(<RapLanding />); const button = screen.getByRole("button", { name: "Continue with your photos" });
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Add both photos");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/orders"))).toBe(false);
  });
  it("restores photos before sign in, labels concept art, and does not start generation", async () => {
    const file = new File(["photo"], "photo.png", { type: "image/png" });
    draft.read.mockResolvedValue({ left: file, right: file, requestId: crypto.randomUUID(), savedAt: Date.now() });
    render(<RapLanding />);
    expect(await screen.findByAltText("left person preview")).toBeInTheDocument();
    expect(screen.getByText("CONCEPT ART · NOT A GENERATED VIDEO")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with your photos" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Signing in does not charge you");
    expect(draft.write).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => /kie|generate|assets|orders/.test(String(u)))).toBe(false);
  });
  it("does not charge or upload in preview mode, even for an authenticated user", async () => {
    auth.signedIn = true; const file = new File(["photo"], "photo.png", { type: "image/png" });
    draft.read.mockResolvedValue({ left: file, right: file, requestId: crypto.randomUUID(), savedAt: Date.now() });
    render(<RapLanding />); await screen.findByAltText("left person preview");
    fireEvent.click(screen.getByRole("button", { name: "Pay $5.99 & generate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkout is not open yet");
    expect(fetchMock.mock.calls.filter(([url, options]) => String(url).includes("/api/rap/orders") && options?.method === "POST")).toHaveLength(0);
  });
});
