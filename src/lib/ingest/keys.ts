import { createHash, randomBytes } from "node:crypto";

export const SECRET_KEY_PREFIX = "sk_live_";

/** New server-to-server key. Only the hash is stored; show `key` once. */
export function generateSecretKey() {
  const key = `${SECRET_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashSecretKey(key), prefix: key.slice(0, SECRET_KEY_PREFIX.length + 4) };
}

export function hashSecretKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** Does `origin` belong to one of the landing page's domains? */
export function originAllowed(origin: string | null, domains: readonly string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((raw) => {
    const domain = raw.trim().toLowerCase();
    if (domain.startsWith("*.")) return host.endsWith(domain.slice(1));
    return host === domain;
  });
}

/** Accepts "https://www.site.com.br/path", "site.com.br" or "*.site.com.br". */
export function normalizeDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const wildcard = value.startsWith("*.");
  const bare = wildcard ? value.slice(2) : value;
  let host: string;
  try {
    host = new URL(bare.includes("://") ? bare : `https://${bare}`).hostname;
  } catch {
    return null;
  }
  if (!/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(host)) return null;
  return wildcard ? `*.${host}` : host;
}
