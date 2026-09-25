import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, decryptSecret, encryptSecret, parseKey } from "@/lib/crypto";

const key = randomBytes(32);

describe("secret encryption", () => {
  it("round-trips and never contains the plain value", () => {
    const stored = encryptSecret("EAAtokenSecreto123", key);
    expect(stored).toMatch(/^enc:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain("EAAtoken");
    expect(decryptSecret(stored, key)).toBe("EAAtokenSecreto123");
  });

  it("uses a new IV each time", () => {
    expect(encryptSecret("x".repeat(30), key)).not.toBe(encryptSecret("x".repeat(30), key));
  });

  it("rejects a wrong key, tampering and plain values", () => {
    const stored = encryptSecret("EAAtokenSecreto123", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(CryptoError);
    const [iv, tag, data] = stored.slice(7).split(".");
    const flipped = `${data[0] === "A" ? "B" : "A"}${data.slice(1)}`;
    expect(() => decryptSecret(`enc:v1:${iv}.${tag}.${flipped}`, key)).toThrow(CryptoError);
    expect(() => decryptSecret("EAAtokenSecreto123", key)).toThrow(CryptoError);
  });

  it("accepts only 32-byte keys", () => {
    expect(parseKey(key.toString("base64url"))?.length).toBe(32);
    expect(parseKey("curta")).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });
});
