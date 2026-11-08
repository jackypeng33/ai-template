import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { refundCredits } from "./credits";
import { getGoogleAuthProvider } from "./auth/google-auth";
import { getGitHubAuthProvider } from "./auth/github-auth";

const defaultTrustedOrigins = ["http://localhost:3000"];

const trustedOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : defaultTrustedOrigins;

const googleAuthProvider = getGoogleAuthProvider();
const githubAuthProvider = getGitHubAuthProvider();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),

  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(googleAuthProvider ? { google: googleAuthProvider } : {}),
    ...(githubAuthProvider ? { github: githubAuthProvider } : {}),
  },

  trustedOrigins,

  databaseHooks: {
    user: {
      create: {
        // Runs for email and OAuth signups, after creation commits. Signing in
        // or linking another provider does not create a user or grant again.
        after: async (user) => {
          try {
            const result = await refundCredits(user.id, 300, "registration_bonus");
            if (!result.success) console.error("[Auth] Failed to grant registration bonus:", user.id);
          } catch (error) {
            console.error("[Auth] Failed to grant registration bonus:", error);
          }
        },
      },
    },
  },
});

export { hashPassword } from "better-auth/crypto";
