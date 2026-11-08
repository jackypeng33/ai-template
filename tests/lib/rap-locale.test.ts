// @vitest-environment node
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
describe("English-only BOOTH locale routing", () => {
  it("keeps the video home in English and preserves payment parameters despite Chinese preferences", () => {
    const response = proxy(new NextRequest("http://localhost:3000/?order=abc&cancelled=1", { headers: { "accept-language": "zh-CN,zh;q=0.9", cookie: "NEXT_LOCALE=zh" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/en?order=abc&cancelled=1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("link")).toBeNull();
  });
  it.each(["/rap", "/rap/", "/en/rap", "/zh/rap", "/en", "/zh", "/zh/"])("redirects %s directly to the video home without losing query values", path => {
    const response = proxy(new NextRequest(`http://localhost:3000${path}?order=abc&cancelled=1&tag=one&tag=two`));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3000/?order=abc&cancelled=1&tag=one&tag=two");
  });
  it("retains English-only Rap subpages at their existing URLs", () => {
    const response = proxy(new NextRequest("http://localhost:3000/rap/policy", { headers: { cookie: "NEXT_LOCALE=zh" } }));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/en/rap/policy");
    expect(proxy(new NextRequest("http://localhost:3000/zh/rap/manage")).headers.get("location")).toBe("http://localhost:3000/rap/manage");
  });
  it("preserves the starter home in both languages", () => {
    const english = proxy(new NextRequest("http://localhost:3000/starter", { headers: { "accept-language": "en" } }));
    expect(english.headers.get("x-middleware-rewrite")).toContain("/en/starter");
    const chinese = proxy(new NextRequest("http://localhost:3000/zh/starter"));
    expect(chinese.status).toBe(200);
    expect(chinese.headers.get("location")).toBeNull();
  });
  it("keeps the starter's Chinese routes working", () => {
    const response = proxy(new NextRequest("http://localhost:3000/zh/pricing"));
    expect(response.status).toBe(200); expect(response.headers.get("location")).toBeNull();
  });
});
