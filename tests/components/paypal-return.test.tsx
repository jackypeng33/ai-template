import { render, screen, waitFor } from "@testing-library/react";
import { PayPalReturn } from "@/features/billing/components/paypal-return";
import messages from "@/messages/en.json";
const fetchMock = vi.fn();
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: keyof typeof messages.paypal, values?: { credits: number }) => messages.paypal[key].replace("{credits}", String(values?.credits ?? 0)),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "buyer" } } }) }));
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("PayPal return page", () => {
  it("only shows success after the server confirms settled credits", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ order: { status: "succeeded", credits: 200, packKey: "pack_200" } })));
    render(<PayPalReturn orderId="local" cancelled={false} />);
    expect(await screen.findByText("Payment confirmed. 200 credits have been added to your account.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });
  it("keeps pending funding separate from success", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ order: { status: "pending", credits: 200 } })));
    const { unmount } = render(<PayPalReturn orderId="local" cancelled={false} />);
    await waitFor(() => expect(screen.getByText(messages.paypal.pending)).toBeInTheDocument());
    expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
    unmount();
  });
  it("does not capture on a cancelled return, but still recognizes an already paid order", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ order: { status: "succeeded", credits: 200, packKey: "pack_200" } })));
    render(<PayPalReturn orderId="local" cancelled />);
    expect(await screen.findByText(/Payment confirmed/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});
