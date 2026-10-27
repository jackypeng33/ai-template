const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  for (const [key, value] of Object.entries({ PAYPAL_ENABLED: "true", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "client", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_WEBHOOK_ID: "WH", PAYPAL_MERCHANT_ID: "merchant", NEXT_PUBLIC_APP_URL: "https://app.example", PAYPAL_SUBSCRIPTIONS_ENABLED: "true", PAYPAL_PLAN_STARTER_YEARLY: "P-YEAR" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function json(value: unknown) { return new Response(JSON.stringify(value)); }
function token() { fetchMock.mockResolvedValueOnce(json({ access_token: "TOKEN", expires_in: 3600 })); }
describe("PayPal subscription REST calls", () => {
  it("creates only a mapped plan, quantity one and stable request ID", async () => {
    const { createPayPalSubscription, getPayPalPlanId } = await import("@/lib/payments/paypal-subscription-api");
    token(); fetchMock.mockResolvedValueOnce(json({ id: "I-SUB", links: [] }));
    await createPayPalSubscription("LOCAL", getPayPalPlanId("starter_yearly"), "zh");
    const [url, options] = fetchMock.mock.calls[1];
    expect(url.endsWith("/v1/billing/subscriptions")).toBe(true);
    expect(options.headers["PayPal-Request-Id"]).toBe("subscribe-LOCAL");
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ plan_id: "P-YEAR", custom_id: "LOCAL", quantity: "1" });
    expect(body.application_context.return_url).toBe("https://app.example/zh/billing/subscription-return?id=LOCAL");
    expect(body.application_context.cancel_url).toContain("cancelled=1");
  });
  it("accepts PayPal's empty 204 cancellation response", async () => {
    const { cancelPayPalSubscription } = await import("@/lib/payments/paypal-subscription-api");
    token(); fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(cancelPayPalSubscription("I-SUB")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[1][0].endsWith("/I-SUB/cancel")).toBe(true);
  });
  it("lists authoritative transactions in a bounded date range and rejects hidden pages", async () => {
    const { listPayPalSubscriptionTransactions } = await import("@/lib/payments/paypal-subscription-api");
    token(); fetchMock.mockResolvedValueOnce(json({ transactions: [], total_pages: 1 }));
    await listPayPalSubscriptionTransactions("I-SUB", new Date("2026-01-01T00:00:00Z"), new Date("2026-01-31T00:00:00Z"));
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.searchParams.get("start_time")).toBe("2026-01-01T00:00:00.000Z");
    expect(url.searchParams.get("end_time")).toBe("2026-01-31T00:00:00.000Z");
    fetchMock.mockResolvedValueOnce(json({ transactions: [], total_pages: 2 }));
    await expect(listPayPalSubscriptionTransactions("I-SUB", new Date("2026-01-01T00:00:00Z"))).rejects.toThrow("SUBSCRIPTION_REQUIRES_REVIEW");
  });
  it("does not offer missing plans or enable subscriptions from the pack flag alone", async () => {
    const { configuredPayPalPlans, getPayPalPlanId } = await import("@/lib/payments/paypal-subscription-api");
    expect(configuredPayPalPlans()).toContain("starter_yearly");
    vi.stubEnv("PAYPAL_SUBSCRIPTIONS_ENABLED", "false");
    expect(configuredPayPalPlans()).toEqual([]);
    expect(() => getPayPalPlanId("starter_yearly")).toThrow("PAYPAL_PLAN_NOT_CONFIGURED");
  });
});
