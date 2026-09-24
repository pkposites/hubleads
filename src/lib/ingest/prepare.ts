import { createHash } from "node:crypto";
import { classifyChannel } from "@/lib/attribution";
import { cleanText, normalizeEmail, normalizePhone, sanitizeUrl } from "@/lib/normalize";
import type { FieldError } from "./errors";
import type { LeadRequest, TrackingFields } from "./schema";

const TOUCH_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "fbc",
  "fbp",
  "ttclid",
  "msclkid",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "page_title",
] as const satisfies readonly (keyof TrackingFields)[];

export type Touch = Partial<Record<(typeof TOUCH_KEYS)[number] | "landing_page_url" | "referrer" | "occurred_at", string>> & {
  channel: string;
};

/** Normalised, classified snapshot of one visit (§5.4, §6). */
export function buildTouch(fields: TrackingFields | null | undefined, fallbackTime: string): Touch {
  const touch: Record<string, string> = {};
  for (const key of TOUCH_KEYS) {
    const value = cleanText(fields?.[key], 512);
    if (value) touch[key] = value;
  }
  const landing = sanitizeUrl(fields?.landing_page_url);
  const referrer = sanitizeUrl(fields?.referrer);
  if (landing) touch.landing_page_url = landing;
  if (referrer) touch.referrer = referrer;
  touch.occurred_at = fields?.occurred_at ?? fallbackTime;
  return { ...touch, channel: classifyChannel(touch) };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashRequest(body: LeadRequest): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

export interface PreparedLead {
  lead: { name: string | null; phone: string | null; phone_norm: string | null; email: string | null; email_norm: string | null };
  answers: Record<string, string>;
  touch: Touch;
  first_touch: Touch | null;
  tracking: Record<string, unknown>;
  consent: Record<string, unknown>;
  session_id: string | null;
}

/** Normalises a validated request. Returns field errors instead of throwing. */
export function prepareLead(
  body: LeadRequest,
  now: Date,
): { ok: true; value: PreparedLead } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const nowIso = now.toISOString();

  const phone = cleanText(body.lead.phone, 40);
  const email = cleanText(body.lead.email, 254);
  const phoneNorm = normalizePhone(phone);
  const emailNorm = normalizeEmail(email);

  if (phone && !phoneNorm) errors.push({ field: "lead.phone", message: "Telefone inválido." });
  if (email && !emailNorm) errors.push({ field: "lead.email", message: "E-mail inválido." });
  if (!phone && !email) errors.push({ field: "lead", message: "Informe telefone ou e-mail." });
  if (errors.length) return { ok: false, errors };

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.answers ?? {})) {
    if (value === null) continue;
    answers[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  const tracking = body.tracking ?? {};
  const touch = buildTouch(tracking, nowIso);
  const firstTouch = tracking.first_touch ? buildTouch(tracking.first_touch, touch.occurred_at ?? nowIso) : null;

  const consent = body.consent
    ? { ...body.consent, captured_at: body.consent.captured_at ?? nowIso }
    : {};

  return {
    ok: true,
    value: {
      lead: { name: cleanText(body.lead.name, 200), phone, phone_norm: phoneNorm, email, email_norm: emailNorm },
      answers,
      touch,
      first_touch: firstTouch,
      // Validated tracking is kept on the conversion for diagnostics (§15.4).
      tracking,
      consent,
      session_id: cleanText(tracking.session_id, 100),
    },
  };
}
