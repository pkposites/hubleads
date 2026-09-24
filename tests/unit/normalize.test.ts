import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone, sanitizeUrl } from "@/lib/normalize";

describe("normalizePhone", () => {
  it.each([
    ["(11) 99999-9999", "+5511999999999"],
    ["11999999999", "+5511999999999"],
    ["+55 11 99999-9999", "+5511999999999"],
    ["5511999999999", "+5511999999999"],
    ["005511999999999", "+5511999999999"],
    ["(21) 3333-4444", "+552133334444"],
    ["+1 415 555 2671", "+14155552671"],
  ])("normalises %s to E.164", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(["", "   ", "123", "abc", "(11) 9999"])("rejects %j", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Joao@Example.COM ")).toBe("joao@example.com");
  });

  it.each(["joao", "joao@", "@example.com", "joao@example", "jo ao@example.com"])("rejects %j", (raw) => {
    expect(normalizeEmail(raw)).toBeNull();
  });
});

describe("sanitizeUrl", () => {
  it("drops fragments and credentials", () => {
    expect(sanitizeUrl("https://user:pw@site.com.br/lp?utm_source=x#token=abc")).toBe(
      "https://site.com.br/lp?utm_source=x",
    );
  });

  it("rejects non-http protocols", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("not a url")).toBeNull();
  });
});

describe("masking for logs", () => {
  it("keeps only what support needs", () => {
    expect(maskPhone("+5511999999999")).toBe("**********9999");
    expect(maskEmail("joao@example.com")).toBe("j***@example.com");
  });
});
