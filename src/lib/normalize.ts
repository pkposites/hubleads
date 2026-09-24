import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

// Blueprint Appendix C.

/** E.164 (e.g. +5511999999999) or null when the number is not valid. */
export function normalizePhone(raw: string | null | undefined, defaultCountry: CountryCode = "BR"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // "0055..." and "55..." without a plus are common in Brazilian forms.
  const candidate = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const phone =
    parsePhoneNumberFromString(candidate, defaultCountry) ??
    (/^\d{12,13}$/.test(candidate) ? parsePhoneNumberFromString(`+${candidate}`) : undefined);
  return phone?.isValid() ? phone.number : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** Trimmed text capped at `max` characters; empty becomes null. */
export function cleanText(raw: unknown, max = 500): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text ? text.slice(0, max) : null;
}

/** http(s) URL without its fragment, or null. */
export function sanitizeUrl(raw: string | null | undefined, max = 2048): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.username = "";
    url.password = "";
    const out = url.toString();
    return out.length <= max ? out : null;
  } catch {
    return null;
  }
}

/** Digits only, for wa.me links. */
export function whatsappDigits(phoneNorm: string | null | undefined): string | null {
  const digits = phoneNorm?.replace(/\D/g, "");
  return digits ? digits : null;
}

/** Masks personal data before it reaches a log line (§15.2). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}
