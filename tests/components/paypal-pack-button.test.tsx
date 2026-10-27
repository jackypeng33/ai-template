import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayPalPackButton } from "@/features/billing/components/paypal-pack-button";
import messages from "@/messages/en.json";
const { fetchMock, pushMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: keyof typeof messages.paypal) => messages.paypal[key] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "buyer" } }, isPending: false }) }));
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("PayPal pack checkout", () => {
  it("hides the button when the server disables PayPal", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ enabled: false })));
    render(<PayPalPackButton packKey="pack_200" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("retains the request ID after a failed attempt and never sends client pricing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 502 })));
    render(<PayPalPackButton packKey="pack_200" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pay with PayPal" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Pay with PayPal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const first = JSON.parse(fetchMock.mock.calls[1][1].body);
    const second = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(first).toEqual(second);
    expect(first).toEqual({ key: "pack_200", locale: "en", requestId: expect.any(String) });
    expect(sessionStorage.getItem("paypal-checkout:buyer:pack_200")).toBe(first.requestId);
  });
});
