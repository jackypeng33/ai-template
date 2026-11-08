// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credits = vi.hoisted(() => ({ grant: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/credits", () => ({ refundCredits: credits.grant }));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter({ user: [], account: [], session: [], verification: [] }) };
});

beforeEach(() => {
  vi.resetModules();
  credits.grant.mockReset().mockResolvedValue({ success: true, remainingCredits: 300 });
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-auth-secret-with-at-least-32-characters");
  vi.stubEnv("AUTH_GOOGLE_ID", ""); vi.stubEnv("AUTH_GOOGLE_SECRET", "");
  vi.stubEnv("AUTH_GITHUB_ID", "github-test-id"); vi.stubEnv("AUTH_GITHUB_SECRET", "github-test-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function githubLogin(auth: typeof import("@/lib/auth").auth, email: string | null, options: { verified?: boolean; denied?: boolean } = {}) {
  // Exercise the real Better Auth redirect/callback and its built-in GitHub
  // email lookup. Only GitHub HTTP and the accounting boundary are mocked.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "test-token", token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json({ id: 1234, login: "octocat", name: "Test User", email: null });
    if (url === "https://api.github.com/user/emails") return Response.json(email ? [{ email, primary: true, verified: options.verified ?? true }] : []);
    throw new Error(`Unexpected HTTP request: ${url}`);
  }));
  const start = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ provider: "github", callbackURL: "/rap" }),
  }));
  expect(start.status).toBe(200);
  const redirect = new URL((await start.json()).url);
  expect(redirect.origin).toBe("https://github.com");
  expect(redirect.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/github");
  expect(redirect.searchParams.get("scope")).toContain("user:email");
  const cookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const callback = new URL("http://localhost:3000/api/auth/callback/github");
  callback.searchParams.set(options.denied ? "error" : "code", options.denied ? "access_denied" : "test-code");
  callback.searchParams.set("state", redirect.searchParams.get("state")!);
  return auth.handler(new Request(callback, { headers: { cookie } }));
}

describe("configured authentication flows", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])("registers Google=%s and GitHub=%s independently", async (google, github) => {
    vi.stubEnv("AUTH_GOOGLE_ID", google ? "google-id" : "");
    vi.stubEnv("AUTH_GOOGLE_SECRET", google ? "google-secret" : "");
    vi.stubEnv("AUTH_GITHUB_ID", github ? "github-id" : "");
    const { auth } = await import("@/lib/auth");
    expect(Boolean(auth.options.socialProviders?.google)).toBe(google);
    expect(Boolean(auth.options.socialProviders?.github)).toBe(github);
  }, 20_000);

  it("signs in with a private verified GitHub email and grants only on first creation", async () => {
    const { auth } = await import("@/lib/auth");
    const first = await githubLogin(auth, "private@test.invalid");
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toMatch(/\/rap$/);
    expect(credits.grant).toHaveBeenCalledTimes(1);
    expect(credits.grant).toHaveBeenCalledWith(expect.any(String), 300, "registration_bonus");
    const again = await githubLogin(auth, "private@test.invalid");
    expect(again.headers.get("location")).toMatch(/\/rap$/);
    expect(credits.grant).toHaveBeenCalledTimes(1);
  });

  it("preserves email signup credits without granting on login or linking GitHub", async () => {
    const { auth } = await import("@/lib/auth");
    const body = { email: "existing@test.invalid", password: "a-secure-test-password" };
    await auth.api.signUpEmail({ body: { ...body, name: "Existing" } });
    await auth.api.signInEmail({ body });
    expect(credits.grant).toHaveBeenCalledTimes(1);
    const linked = await githubLogin(auth, body.email);
    expect(linked.headers.get("location")).toMatch(/\/rap$/);
    expect(credits.grant).toHaveBeenCalledTimes(1);
  });

  it("rejects a GitHub identity with no usable email without granting credits", async () => {
    const { auth } = await import("@/lib/auth");
    const response = await githubLogin(auth, null);
    expect(response.headers.get("location")).toContain("email_not_found");
    expect(credits.grant).not.toHaveBeenCalled();
  });

  it("does not link an unverified GitHub email to an existing account", async () => {
    const { auth } = await import("@/lib/auth");
    await auth.api.signUpEmail({ body: { email: "existing@test.invalid", password: "a-secure-test-password", name: "Existing" } });
    const response = await githubLogin(auth, "existing@test.invalid", { verified: false });
    expect(response.headers.get("location")).toContain("error=");
    expect(response.headers.get("location")).not.toMatch(/\/rap$/);
    expect(credits.grant).toHaveBeenCalledTimes(1);
  });

  it("handles denied authorization without creating a user or contacting GitHub", async () => {
    const { auth } = await import("@/lib/auth");
    const response = await githubLogin(auth, null, { denied: true });
    expect(response.headers.get("location")).toContain("access_denied");
    expect(fetch).not.toHaveBeenCalled();
    expect(credits.grant).not.toHaveBeenCalled();
  });
});
