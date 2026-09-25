import { createHash } from "node:crypto";

/**
 * Meta Conversions API: builds the events a lead's progress should send
 * (Schedule when it is booked, Purchase when a sale has a value) and the
 * request body. Pure functions, so they can be tested without the network.
 */

export const META_EVENTS = { agendado: "Schedule", venda: "Purchase" } as const;

export interface MetaConfig {
  pixel_id: string;
  access_token: string;
  test_event_code: string | null;
  send_schedule: boolean;
  send_purchase: boolean;
}

/** The fields of a stored lead row that matter to Meta. */
export interface MetaLead {
  id: string;
  workspace_id: string;
  visitor_id: string | null;
  status: string;
  name: string | null;
  phone: string | null;
  sale_value: number | string | null;
  fbc: string | null;
  fbp: string | null;
  ip_address: string | null;
  user_agent: string | null;
  landing_url: string | null;
  /** false: the visitor refused tracking on the landing page (LGPD). */
  tracking_consent?: boolean | null;
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Lowercase, no accents or punctuation, as Meta asks before hashing names. */
export function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** Digits with country code ("+55 11 91234-5678" -> "5511912345678"). */
export function normalizeMetaPhone(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Brazilian numbers stored without the country code.
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function userData(lead: MetaLead) {
  const data: Record<string, unknown> = { country: [sha256("br")] };
  const phone = normalizeMetaPhone(lead.phone);
  if (phone) data.ph = [sha256(phone)];
  const parts = (lead.name ?? "").trim().split(/\s+/).map(normalizeName).filter(Boolean);
  if (parts.length > 0) data.fn = [sha256(parts[0])];
  if (parts.length > 1) data.ln = [sha256(parts[parts.length - 1])];
  if (lead.visitor_id) data.external_id = [sha256(lead.visitor_id)];
  if (lead.ip_address) data.client_ip_address = lead.ip_address;
  if (lead.user_agent) data.client_user_agent = lead.user_agent;
  if (lead.fbc) data.fbc = lead.fbc;
  if (lead.fbp) data.fbp = lead.fbp;
  return data;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

/** Events the lead is due to send, skipping the ones already delivered. */
export function dueEvents(lead: MetaLead, config: MetaConfig, sent: readonly string[], now = new Date()): MetaEvent[] {
  const events: MetaEvent[] = [];
  // Nothing about people who refused tracking goes to Meta.
  if (lead.tracking_consent === false) return events;
  const value = lead.sale_value === null || lead.sale_value === "" ? null : Number(lead.sale_value);
  const wanted: { name: string; custom?: Record<string, unknown> }[] = [];
  if (lead.status === "agendado" && config.send_schedule) wanted.push({ name: META_EVENTS.agendado });
  if (lead.status === "venda" && config.send_purchase && value !== null && value > 0) {
    wanted.push({ name: META_EVENTS.venda, custom: { currency: "BRL", value } });
  }
  // Clicks from the landing page carry the browser data Meta needs for
  // "website" events; rows typed in by hand are reported as chat conversions.
  const website = Boolean(lead.user_agent && lead.landing_url);
  for (const w of wanted) {
    if (sent.includes(w.name)) continue;
    events.push({
      event_name: w.name,
      event_time: Math.floor(now.getTime() / 1000),
      event_id: `${lead.id}.${w.name}`,
      action_source: website ? "website" : "chat",
      ...(website && { event_source_url: lead.landing_url as string }),
      user_data: userData(lead),
      ...(w.custom && { custom_data: w.custom }),
    });
  }
  return events;
}

export const graphVersion = () => process.env.META_GRAPH_VERSION || "v24.0";

/** POSTs one event; returns whether Meta accepted it and a short, token-free response. */
export async function sendMetaEvent(
  config: Pick<MetaConfig, "pixel_id" | "access_token" | "test_event_code">,
  event: MetaEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; response: string }> {
  const url = `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(config.pixel_id)}/events`;
  const body = {
    data: [event],
    ...(config.test_event_code && { test_event_code: config.test_event_code }),
    access_token: config.access_token,
  };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await res.text()).slice(0, 1000);
    return { ok: res.ok, response: text.split(config.access_token).join("***") };
  } catch (error) {
    return { ok: false, response: (error as Error).name || "network error" };
  }
}
