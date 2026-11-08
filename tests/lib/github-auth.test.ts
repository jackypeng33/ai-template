import { getGitHubAuthProvider, isGitHubAuthEnabled } from "@/lib/auth/github-auth";

describe("GitHub auth config", () => {
  it("requires both nonblank credentials", () => {
    for (const env of [{}, { AUTH_GITHUB_ID: "id" }, { AUTH_GITHUB_SECRET: "secret" }, { AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "  " }]) {
      expect(isGitHubAuthEnabled(env)).toBe(false);
    }
    expect(getGitHubAuthProvider({ AUTH_GITHUB_ID: " id ", AUTH_GITHUB_SECRET: " secret " })).toEqual({ clientId: "id", clientSecret: "secret" });
  });
});
