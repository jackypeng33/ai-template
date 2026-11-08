// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";

afterEach(() => vi.unstubAllEnvs());

describe("preserved starter sitemap", () => {
  it("lists actual starter canonical URLs and omits preview and redirected home URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://booth.example.com");
    const entries = sitemap();
    const urls = entries.map(entry => entry.url);
    expect(urls).toContain("https://booth.example.com/starter");
    expect(urls).toContain("https://booth.example.com/zh/starter");
    expect(urls).toContain("https://booth.example.com/pricing");
    expect(urls.some(url => /\/(?:en|rap)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
    expect(urls).not.toContain("https://booth.example.com/");
    expect(urls).not.toContain("https://booth.example.com/zh");
    expect(entries.find(entry => entry.url === "https://booth.example.com/starter")?.alternates?.languages).toEqual({
      en: "https://booth.example.com/starter", zh: "https://booth.example.com/zh/starter",
    });
  });
});
