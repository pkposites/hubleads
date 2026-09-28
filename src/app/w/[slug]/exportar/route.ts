import type { NextRequest } from "next/server";
import { CHANNELS } from "@/lib/attribution";
import { call } from "@/lib/db";
import { isStatus, leadsToCsv, type Lead } from "@/lib/leads";
import { resolveColumns, type SheetConfig } from "@/lib/sheet-columns";
import { SOURCE_LABELS } from "@/lib/source-labels";
import { periodArgs, resolvePeriod } from "@/lib/period";
import { currentSession } from "@/lib/session";

export async function GET(request: NextRequest, ctx: RouteContext<"/w/[slug]/exportar">) {
  const { slug } = await ctx.params;
  const session = await currentSession();
  if (!session || session.workspace.slug !== slug) {
    return new Response("Sessão expirada. Entre novamente.", { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  // Without a period in the address, the export has all the history.
  const period = resolvePeriod({ periodo: sp.get("periodo") ?? "tudo", de: sp.get("de") ?? undefined, ate: sp.get("ate") ?? undefined });
  const status = sp.get("status");
  const channel = sp.get("origem");
  const source = sp.get("fonte");

  const rows: Lead[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const page = await call<{ total: number; rows: Lead[] }>("lh_list_leads", {
      p_token: session.token,
      ...periodArgs(period),
      p_status: isStatus(status) ? status : null,
      p_channel: channel && channel in CHANNELS ? channel : null,
      p_source: source && source in SOURCE_LABELS ? source : null,
      p_search: sp.get("q") || null,
      p_limit: 1000,
      p_offset: offset,
    });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) break;
  }

  // Who exported how many rows stays in the audit log (LGPD).
  await call("lh_log_export", {
    p_token: session.token,
    p_rows: rows.length,
    p_filters: { ...period.query, status: status ?? null, origem: channel ?? null, fonte: source ?? null, busca: Boolean(sp.get("q")) },
  });

  const config = await call<SheetConfig>("lh_sheet_config", { p_token: session.token });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(leadsToCsv(rows, resolveColumns(config.columns)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${slug}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
