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
  /** Visitors who did not accept cookies still go, with the minimum (see minimalUserData). */
  minimal_tracking?: boolean;
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
  /** Leads from Meta's native forms go back as CRM events with their lead id. */
  source?: string | null;
  meta_lead_id?: string | null;
  email?: string | null;
  created_at?: string | null;
}

/** Name of the CRM system in Meta's Conversion Leads setup. */
export const CRM_SOURCE_NAME = "Lead Hub";

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

/**
 * user_data of a visitor who did not accept cookies (measurement without
 * cookies): only the ad click id read from the address, IP and browser. No
 * name, phone, visitor id or _fbp.
 */
export function minimalUserData(lead: MetaLead) {
  const data: Record<string, unknown> = {};
  if (lead.ip_address) data.client_ip_address = lead.ip_address;
  if (lead.user_agent) data.client_user_agent = lead.user_agent;
  if (lead.fbc) data.fbc = lead.fbc;
  return data;
}

/** user_data of a CRM event: the Meta lead id plus hashed phone, e-mail and name. */
export function crmUserData(lead: MetaLead) {
  const data: Record<string, unknown> = { lead_id: lead.meta_lead_id };
  const phone = normalizeMetaPhone(lead.phone);
  if (phone) data.ph = [sha256(phone)];
  const email = (lead.email ?? "").trim().toLowerCase();
  if (email) data.em = [sha256(email)];
  const parts = (lead.name ?? "").trim().split(/\s+/).map(normalizeName).filter(Boolean);
  if (parts.length > 0) data.fn = [sha256(parts[0])];
  if (parts.length > 1) data.ln = [sha256(parts[parts.length - 1])];
  return data;
}

const isFormLead = (lead: MetaLead) => lead.source === "meta_form" && Boolean(lead.meta_lead_id);

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

/** Meta refuses events older than this. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Events the lead is due to send, skipping the ones already delivered.
 * statusAt: when the lead entered its current status (the conversion time);
 * conversions older than 7 days are no longer sent.
 */
export function dueEvents(
  lead: MetaLead,
  config: MetaConfig,
  sent: readonly string[],
  now = new Date(),
  statusAt: string | null = null,
): MetaEvent[] {
  const events: MetaEvent[] = [];
  // People who did not accept cookies go only with the measurement without
  // cookies, and only when the client keeps it on.
  const minimal = lead.tracking_consent === false;
  if (minimal && !config.minimal_tracking) return events;
  const at = statusAt ? new Date(statusAt) : now;
  const statusTooOld = Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > MAX_EVENT_AGE_MS;
  const value = lead.sale_value === null || lead.sale_value === "" ? null : Number(lead.sale_value);
  const wanted: { name: string; custom?: Record<string, unknown>; time?: Date }[] = [];
  const crm = isFormLead(lead);
  // Their Lead too: the page's pixel stayed off, so Meta never saw the click.
  const minimalLead = minimal && !crm && Boolean(lead.ip_address && lead.user_agent);
  if ((crm || minimalLead) && !sent.includes("Lead") && lead.created_at) {
    // The stage the lead enters with; Meta needs it to learn the funnel.
    const created = new Date(lead.created_at);
    if (!Number.isNaN(created.getTime()) && now.getTime() - created.getTime() <= MAX_EVENT_AGE_MS) wanted.push({ name: "Lead", time: created });
  }
  if (!statusTooOld && lead.status === "agendado" && config.send_schedule) wanted.push({ name: META_EVENTS.agendado });
  if (!statusTooOld && lead.status === "venda" && config.send_purchase && value !== null && value > 0) {
    wanted.push({ name: META_EVENTS.venda, custom: { currency: "BRL", value } });
  }
  for (const w of wanted) {
    if (sent.includes(w.name)) continue;
    const time = Math.floor(Math.min((w.time ?? at).getTime(), now.getTime()) / 1000);
    if (crm) {
      // Conversion Leads (CRM events): the Meta lead id identifies the person.
      events.push({
        event_name: w.name,
        event_time: time,
        event_id: `${lead.id}.${w.name}`,
        action_source: "system_generated",
        user_data: crmUserData(lead),
        custom_data: { event_source: "crm", lead_event_source: CRM_SOURCE_NAME, ...w.custom },
      });
      continue;
    }
    if (minimal) {
      const user = minimalUserData(lead);
      if (Object.keys(user).length === 0) continue;
      const website = w.name === "Lead" && /^https?:\/\//.test(lead.landing_url ?? "");
      events.push({
        event_name: w.name,
        event_time: time,
        event_id: `${lead.id}.${w.name}`,
        // The click happened on the page; booking and sale in the conversation.
        action_source: website ? "website" : "chat",
        ...(website && { event_source_url: lead.landing_url! }),
        user_data: user,
        ...(w.custom && { custom_data: w.custom }),
      });
      continue;
    }
    events.push({
      event_name: w.name,
      event_time: time,
      event_id: `${lead.id}.${w.name}`,
      // The booking and the sale happen in the WhatsApp conversation, not on
      // the site; the click ids (fbc/fbp) still link them to the ad.
      action_source: "chat",
      user_data: userData(lead),
      ...(w.custom && { custom_data: w.custom }),
    });
  }
  return events;
}

export const graphVersion = () => process.env.META_GRAPH_VERSION || "v24.0";

/** Graph API address; LH_META_GRAPH_URL points it at a fake server in end-to-end tests only. */
export const graphBase = () => (process.env.LH_META_GRAPH_URL || "https://graph.facebook.com").replace(/\/$/, "");

/**
 * Page view of a visitor without cookies (sent straight away, never stored):
 * the page address without parameters, the ad click id, IP and browser.
 */
export function minimalPageView(view: { fbc?: string; url?: string; ip: string; userAgent: string }, eventId: string, now = new Date()): MetaEvent {
  return {
    event_name: "PageView",
    event_time: Math.floor(now.getTime() / 1000),
    event_id: eventId,
    action_source: "website",
    ...(view.url && { event_source_url: view.url }),
    user_data: { client_ip_address: view.ip, client_user_agent: view.userAgent, ...(view.fbc && { fbc: view.fbc }) },
  };
}

/** POSTs one event; returns whether Meta accepted it and a short, token-free response. */
export async function sendMetaEvent(
  config: Pick<MetaConfig, "pixel_id" | "access_token" | "test_event_code">,
  event: MetaEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; response: string }> {
  const url = `${graphBase()}/${graphVersion()}/${encodeURIComponent(config.pixel_id)}/events`;
  const body = {
    data: [event],
    ...(config.test_event_code && { test_event_code: config.test_event_code }),
    access_token: config.access_token,
  };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Meta wants lead_id as a number; it can exceed JavaScript's safe
      // integers, so it is written as digits straight into the JSON.
      body: JSON.stringify(body).replace(/"lead_id":"(\d{5,30})"/g, '"lead_id":$1'),
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await res.text()).slice(0, 1000);
    return { ok: res.ok, response: text.split(config.access_token).join("***") };
  } catch (error) {
    return { ok: false, response: (error as Error).name || "network error" };
  }
}
