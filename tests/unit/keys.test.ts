import { describe, expect, it } from "vitest";
import { generateSecretKey, hashSecretKey, normalizeDomain, originAllowed } from "@/lib/ingest/keys";

describe("secret keys", () => {
  it("stores a hash that matches the shown key", () => {
    const { key, hash, prefix } = generateSecretKey();
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashSecretKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.startsWith(prefix)).toBe(true);
  });
});

describe("originAllowed", () => {
  const domains = ["cliente.com.br", "*.lp.cliente.com.br"];

  it.each([
    ["https://cliente.com.br", true],
    ["http://cliente.com.br", true],
    ["https://www.cliente.com.br", false],
    ["https://a.lp.cliente.com.br", true],
    ["https://lp.cliente.com.br", false],
    ["https://cliente.com.br.evil.com", false],
    ["https://evilcliente.com.br", false],
    [null, false],
    ["null", false],
  ])("%s -> %s", (origin, expected) => {
    expect(originAllowed(origin, domains)).toBe(expected);
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Cliente.com.br/lp?x=1", "www.cliente.com.br"],
    ["cliente.com.br", "cliente.com.br"],
    ["*.cliente.com.br", "*.cliente.com.br"],
    ["localhost", "localhost"],
    ["not a domain", null],
    ["", null],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeDomain(raw)).toBe(expected);
  });
});
