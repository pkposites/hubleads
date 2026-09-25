import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for secrets kept in the database (the Meta access token).
 * AES-256-GCM with a key that lives only in the host (LH_ENCRYPTION_KEY,
 * 32 random bytes in base64url), so the database never holds anything usable.
 * Format: "enc:v1:<iv>.<auth tag>.<ciphertext>", all base64url.
 */

const PREFIX = "enc:v1:";

export class CryptoError extends Error {}

export function parseKey(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw, "base64url");
  return key.length === 32 ? key : null;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptSecret(stored: string, key: Buffer): string {
  if (!stored.startsWith(PREFIX)) throw new CryptoError("not encrypted");
  const [iv, tag, data] = stored.slice(PREFIX.length).split(".");
  if (!iv || !tag || !data) throw new CryptoError("malformed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered value.
    throw new CryptoError("cannot decrypt");
  }
}
