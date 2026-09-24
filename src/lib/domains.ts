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
