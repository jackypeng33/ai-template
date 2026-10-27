// @vitest-environment node
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
describe("English-only BOOTH locale routing", () => {
  it("ignores Chinese browser preferences and cookies on the independent product", () => {
    const response = proxy(new NextRequest("http://localhost:3000/rap?order=abc", { headers: { "accept-language": "zh-CN,zh;q=0.9", cookie: "NEXT_LOCALE=zh" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/en/rap?order=abc");
    expect(response.headers.get("location")).toBeNull();
  });
  it("canonicalizes a localized product URL, preserving the order query", () => {
    const response = proxy(new NextRequest("http://localhost:3000/zh/rap?order=abc"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/rap?order=abc");
  });
  it("keeps the starter's Chinese routes working", () => {
    const response = proxy(new NextRequest("http://localhost:3000/zh/pricing"));
    expect(response.status).toBe(200); expect(response.headers.get("location")).toBeNull();
  });
});
