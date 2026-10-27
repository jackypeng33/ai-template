const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PAYPAL_ENABLED", "true");
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "webhook");
  vi.stubEnv("PAYPAL_MERCHANT_ID", "merchant");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }); }

describe("PayPal REST client", () => {
  it("creates a server-priced order with stable idempotency and locale-aware return URLs", async () => {
    const { remoteOrder, localOrder } = await import("./paypal-fixtures");
    fetchMock.mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 })).mockResolvedValueOnce(json(remoteOrder));
    const { createPayPalOrder } = await import("@/lib/payments/paypal");
    await createPayPalOrder({ ...localOrder, locale: "zh" });
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(options.headers["PayPal-Request-Id"]).toBe(`create-${localOrder.id}`);
    const body = JSON.parse(options.body);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "5.00" });
    expect(body.purchase_units[0].payee).toEqual({ merchant_id: "merchant" });
    expect(body.payment_source.paypal.experience_context.return_url).toContain("https://app.example/zh/billing/return?orderId=");
  });
  it("reuses a cached access token and the same capture request ID", async () => {
    const { remoteOrder } = await import("./paypal-fixtures");
    fetchMock.mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 })).mockImplementation(() => Promise.resolve(json(remoteOrder)));
    const { capturePayPalOrder } = await import("@/lib/payments/paypal");
    await capturePayPalOrder("REMOTE", "local-id");
    await capturePayPalOrder("REMOTE", "local-id");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls.slice(1)) expect(options.headers["PayPal-Request-Id"]).toBe("capture-local-id");
  });
  it("fails closed on missing configuration or invalid environment", async () => {
    const { isPayPalEnabled, getPayPalConfig } = await import("@/lib/payments/paypal");
    vi.stubEnv("PAYPAL_ENV", "https://evil.example");
    expect(isPayPalEnabled()).toBe(false);
    expect(getPayPalConfig).toThrow("PAYPAL_NOT_CONFIGURED");
  });
  it("requires all signature headers and a SUCCESS verification response", async () => {
    const { verifyPayPalWebhook } = await import("@/lib/payments/paypal");
    expect(await verifyPayPalWebhook(new Headers(), {})).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const headers = new Headers(Object.fromEntries(["auth-algo", "cert-url", "transmission-id", "transmission-sig", "transmission-time"].map(key => [`paypal-${key}`, "value"])));
    fetchMock.mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ verification_status: "FAILURE" }))
      .mockResolvedValueOnce(json({ verification_status: "SUCCESS" }));
    expect(await verifyPayPalWebhook(headers, { id: "WH" })).toBe(false);
    expect(await verifyPayPalWebhook(headers, { id: "WH" })).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ webhook_id: "webhook", webhook_event: { id: "WH" } });
  });
  it("does not expose provider error details", async () => {
    const { getPayPalOrder } = await import("@/lib/payments/paypal");
    fetchMock.mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response("buyer private data", { status: 422 }));
    await expect(getPayPalOrder("REMOTE")).rejects.toThrow("PAYPAL_REQUEST_FAILED");
  });
});
