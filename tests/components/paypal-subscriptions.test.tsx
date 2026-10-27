import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayPalSubscriptions } from "@/features/billing/components/paypal-subscriptions";
import { SubscriptionCheckoutButton } from "@/features/billing/components/subscription-checkout-button";
import messages from "@/messages/en.json";

const { fetchMock, pushMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: (namespace: string) => (key: string) => {
  const value = `${namespace}.${key}`.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);
  if (typeof value !== "string") throw new Error(`Missing translation: ${namespace}.${key}`);
  return value;
} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "buyer" } }, isPending: false }) }));
const base = { id: "local", planKey: "starter_yearly", status: "active", paidThrough: "2027-01-01T00:00:00Z", nextBillingAt: "2027-01-01T00:00:00Z", reviewRequired: false, approvalUrl: null };
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("PayPal subscriptions UI", () => {
  it("requires explicit cancellation confirmation and retains the paid period", async () => {
    let canceled = false;
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") { canceled = true; return json({ subscription: { ...base, status: "canceled" } }); }
      return json({ subscriptions: [{ ...base, status: canceled ? "canceled" : "active" }] });
    });
    render(<PayPalSubscriptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop automatic renewal" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(messages.paypalSubscription.cancelExplanation)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await screen.findByText(/Automatic renewal stopped/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "cancel" }) });
    expect(screen.getByText(/Paid access ends/)).toBeInTheDocument();
    expect(screen.queryByText(/Next automatic payment/)).not.toBeInTheDocument();
  });
  it("keeps activation without a payment in the awaiting-payment state", async () => {
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => options?.method === "POST"
      ? json({ subscription: { ...base, paidThrough: null } }) : json({ subscriptions: [{ ...base, paidThrough: null }] }));
    const { unmount } = render(<PayPalSubscriptions initialId="local" />);
    await screen.findByRole("heading", { name: "Starter Yearly" });
    expect(screen.getByText(messages.paypalSubscription.waiting)).toBeInTheDocument();
    expect(screen.queryByText(/credits have been added/i)).not.toBeInTheDocument();
    unmount();
  });
  it("does not sync or cancel merely because the return URL says cancelled", async () => {
    fetchMock.mockResolvedValue(json({ subscriptions: [base] }));
    render(<PayPalSubscriptions initialId="local" cancelled />);
    await screen.findByText(messages.paypalSubscription.approvalCancelled);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
  it("retains the Creem action while PayPal subscription mode is disabled", async () => {
    const onCreem = vi.fn();
    fetchMock.mockResolvedValue(json({ subscriptionsEnabled: false, subscriptionPlans: [] }));
    render(<SubscriptionCheckoutButton planKey="starter_monthly" onCreem={onCreem}>Subscribe</SubscriptionCheckoutButton>);
    const button = screen.getByRole("button", { name: "Subscribe" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(onCreem).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toBeEnabled());
  });
  it("blocks unconfigured plans instead of creating a subscription through the other provider", async () => {
    const onCreem = vi.fn();
    fetchMock.mockResolvedValue(json({ subscriptionsEnabled: true, subscriptionPlans: [] }));
    render(<SubscriptionCheckoutButton planKey="starter_monthly" onCreem={onCreem}>Subscribe</SubscriptionCheckoutButton>);
    expect(await screen.findByRole("button", { name: "Subscription unavailable" })).toBeDisabled();
    expect(onCreem).not.toHaveBeenCalled();
  });
  it("handles an existing subscription without starting another checkout", async () => {
    fetchMock.mockResolvedValueOnce(json({ subscriptionsEnabled: true, subscriptionPlans: ["starter_monthly"] }))
      .mockImplementation(() => Promise.resolve(json({ error: "SUBSCRIPTION_ALREADY_EXISTS" }, 409)));
    render(<SubscriptionCheckoutButton planKey="starter_monthly" onCreem={vi.fn()}>Subscribe</SubscriptionCheckoutButton>);
    fireEvent.click(await screen.findByRole("button", { name: "Subscribe with PayPal" }));
    await screen.findByRole("alert");
    expect(screen.getByText(messages.paypalSubscription.alreadyExists, { exact: false })).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ key: "starter_monthly", locale: "en", requestId: expect.any(String) });
  });
});
