import { createHmac } from "node:crypto";
import { after } from "next/server";
import { clientIp } from "@/lib/collect";
import { sendLeadConversions } from "@/lib/conversions";
import { call, DbError } from "@/lib/db";
import { mapSheetRow } from "@/lib/lead-sources";
import { notifyNewLead } from "@/lib/push";
import { serverSecret } from "@/lib/server";

/**
 * POST /api/sources/sheets: the Apps Script of a Google Sheet sends its new
 * rows here, with the source's key ("Authorization: Bearer lhs_..."). Each
 * row becomes a lead (once). Logs carry only counts, never row contents.
 */

const MAX_ROWS = 100;
const MAX_BODY = 512 * 1024;

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), route: "POST /api/sources/sheets", ...entry }));

export async function POST(request: Request) {
  const secret = serverSecret();
  if (!secret) return json(503, { error: "servidor sem configuração" });
  const key = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!/^lhs_[0-9a-f]{48}$/.test(key)) return json(401, { error: "chave inválida" });

  const ip = clientIp(request);
  const client = ip ? createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32) : "";
  const source = await call<{ id: string; limited?: boolean } | null>("lh_server_source_for_key", { p_secret: secret, p_client: client, p_key: key });
  if (source?.limited) return json(429, { error: "muitas requisições" });
  if (!source) return json(401, { error: "chave inválida ou fonte pausada" });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "envie no máximo 100 linhas por vez" });
  let rows: unknown;
  try {
    rows = (JSON.parse(raw) as { rows?: unknown }).rows;
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return json(400, { error: "envie { rows: [...] } com até 100 linhas" });

  const result = { received: rows.length, new: 0, duplicate: 0, ignored: 0, errors: 0 };
  const created: string[] = [];
  for (const row of rows) {
    const lead = row && typeof row === "object" && !Array.isArray(row) ? mapSheetRow(row as Record<string, unknown>, source.id) : null;
    if (!lead) {
      result.ignored++;
      continue;
    }
    try {
      const stored = await call<{ lead_id: string; new: boolean }>("lh_server_source_lead", { p_secret: secret, p_source: source.id, p_lead: lead });
      if (stored.new) {
        result.new++;
        created.push(stored.lead_id);
      } else result.duplicate++;
    } catch (error) {
      result.errors++;
      log({ error_code: error instanceof DbError ? error.code : "unknown" });
    }
  }
  if (result.errors) {
    await call("lh_server_source_seen", {
      p_secret: secret,
      p_source: source.id,
      p_error: `${result.errors} ${result.errors === 1 ? "linha não pôde ser lida" : "linhas não puderam ser lidas"} no último envio.`,
    }).catch(() => undefined);
  } else if (!result.new) {
    await call("lh_server_source_seen", { p_secret: secret, p_source: source.id, p_error: null }).catch(() => undefined);
  }
  // Attendants are notified and Meta hears about form leads after the answer.
  after(async () => {
    for (const id of created) {
      await notifyNewLead(id);
      await sendLeadConversions(id);
    }
  });
  log(result);
  return json(200, result);
}
