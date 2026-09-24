import { z } from "zod";
import { classifyChannel } from "@/lib/attribution";

// POST /api/collect: events sent by public/tracker.js. Kept free of Next.js
// and the database client so it can be tested with plain Requests.

const MAX_BODY_BYTES = 16 * 1024;

const text = (max: number) => z.string().max(max).optional().nullable();

const eventSchema = z.object({
  key: z.string().min(1).max(100),
  type: z.string().regex(/^[a-z0-9_.:-]{1,40}$/i),
  visitor_id: z.string().regex(/^[a-z0-9_-]{6,64}$/i),
  url: text(2000),
  title: text(300),
  name: text(120),
  code: z.string().regex(/^[2-9A-HJ-NP-Z]{4,8}$/i).optional().nullable(),
  attribution: z.record(z.string(), z.unknown()).optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional().nullable(),
});

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
  "msclkid",
  "campaign_id",
  "adset_id",
  "ad_id",
  "fbc",
  "fbp",
  "landing_url",
  "referrer",
  "first_seen_at",
] as const;

export interface CollectDeps {
  collect(key: string, originHost: string | null, event: Record<string, unknown>): Promise<Record<string, unknown>>;
  pageConfig(key: string): Promise<{ whatsapp_code: boolean } | null>;
  log(entry: Record<string, unknown>): void;
}

export const COLLECT_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...COLLECT_CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function deviceFrom(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return ua ? "desktop" : "desconhecido";
}

function originHost(request: Request): string | null {
  for (const header of ["origin", "referer"]) {
    const value = request.headers.get(header);
    if (!value || value === "null") continue;
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      // ignore malformed header
    }
  }
  return null;
}

/** GET /api/collect?key=...: the page settings the tracker needs. */
export async function handleConfig(request: Request, deps: CollectDeps): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return json(400, { error: "key is required" });
  const config = await deps.pageConfig(key).catch(() => null);
  return config ? json(200, config) : json(404, { error: "unknown key" });
}

export async function handleCollect(request: Request, deps: CollectDeps): Promise<Response> {
  const started = Date.now();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: "too large" });

  let parsed;
  try {
    parsed = eventSchema.safeParse(JSON.parse(raw));
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (!parsed.success) return json(400, { error: "invalid event" });

  const event = parsed.data;
  const attribution: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = event.attribution?.[key];
    if (typeof value === "string" && value.trim()) attribution[key] = value.trim().slice(0, 2000);
  }

  const channel = classifyChannel({ ...attribution, landing_page_url: attribution.landing_url });
  const device = deviceFrom(request.headers.get("user-agent"));
  const host = originHost(request);

  try {
    const result = await deps.collect(event.key, host, {
      type: event.type,
      visitor_id: event.visitor_id,
      url: event.url,
      title: event.title,
      name: event.name?.trim() || undefined,
      code: event.code?.toUpperCase(),
      channel,
      device,
      attribution,
      data: event.data ?? {},
    });
    // Logs never carry names, codes or URLs (§15.2).
    deps.log({ route: "POST /api/collect", type: event.type, status: 200, channel, latency_ms: Date.now() - started });
    return json(200, { ok: true, code: result.code ?? null });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const status = code === "LH401" ? 401 : code === "LH403" ? 403 : code === "22023" ? 400 : 500;
    deps.log({ route: "POST /api/collect", type: event.type, status, error_code: code ?? "unknown" });
    return json(status, { error: status === 500 ? "internal error" : code });
  }
}
