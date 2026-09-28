import Link from "next/link";
import { buttonClass, controlClass, EmptyState } from "@/components/ui";
import { CHANNELS } from "@/lib/attribution";
import { SOURCE_LABELS, sourceLabel } from "@/lib/source-labels";
import { call } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { formatRate, isStatus, rate, STATUSES, type Lead, type Stats } from "@/lib/leads";
import { countTrend, formatRange, periodArgs, rateTrend, resolvePeriod, type Trend } from "@/lib/period";
import { TrendLine } from "@/components/trend";
import { requireWorkspace } from "@/lib/session";
import { LeadSheet } from "./lead-sheet";
import { NewLeadForm } from "./new-lead-form";
import { PeriodPicker } from "./period-picker";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Tile({ label, value, hint, trend }: { label: string; value: string | number; hint?: string; trend?: Trend | null }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <TrendLine trend={trend ?? null} />
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export default async function SheetPage({ params, searchParams }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = resolvePeriod({ periodo: first(sp.periodo), de: first(sp.de), ate: first(sp.ate) });
  const status = isStatus(first(sp.status)) ? first(sp.status) : "";
  const channel = first(sp.origem) in CHANNELS ? first(sp.origem) : "";
  const source = first(sp.fonte) in SOURCE_LABELS ? first(sp.fonte) : "";
  const q = first(sp.q).trim().slice(0, 100);

  const { token } = await requireWorkspace(slug);
  const [stats, previous, list] = await Promise.all([
    call<Stats>("lh_stats", { p_token: token, ...periodArgs(period) }),
    period.previous ? call<Stats>("lh_stats", { p_token: token, ...periodArgs(period.previous) }) : null,
    call<{ total: number; rows: Lead[] }>("lh_list_leads", {
      p_token: token,
      ...periodArgs(period),
      p_status: status || null,
      p_channel: channel || null,
      p_source: source || null,
      p_search: q || null,
      p_limit: 500,
      p_offset: 0,
    }),
  ]);

  const lpEvents = list.rows.length
    ? await call<Record<string, string[]>>("lh_lead_lp_events", { p_token: token, p_lead_ids: list.rows.map((l) => l.id) })
    : {};

  const exportQuery = new URLSearchParams({
    ...period.query,
    ...(status && { status }),
    ...(channel && { origem: channel }),
    ...(source && { fonte: source }),
    ...(q && { q }),
  });
  const bySource = (stats.by_source ?? []).filter((s) => s.leads > 0);
  const compareText = period.previous ? formatRange(period.previous) : null;
  const trend = (pick: (s: Stats) => number) => (previous ? countTrend(pick(stats), pick(previous)) : null);

  return (
    <div className="flex flex-col gap-4">
      <PeriodPicker
        period={period.key}
        from={period.from}
        to={period.to}
        rangeText={period.key === "tudo" ? "Todo o histórico" : formatRange(period)}
        compareText={compareText}
      />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Link
          href={`/w/${slug}/metricas?${new URLSearchParams(period.query)}`}
          className="col-span-2 rounded-lg border border-[#2a78d6]/30 bg-[#2a78d6]/5 px-3 py-2.5 hover:bg-[#2a78d6]/10 sm:px-4 sm:py-3 md:col-span-1"
        >
          <div className="text-xs text-zinc-600">Conversão da LP</div>
          <div className="text-2xl font-semibold">{formatRate(rate(stats.clicks, stats.visitors))}</div>
          <TrendLine trend={previous ? rateTrend(rate(stats.clicks, stats.visitors), rate(previous.clicks, previous.visitors)) : null} />
          <div className="text-xs text-zinc-600">Ver métricas →</div>
        </Link>
        <Tile
          label="Leads (todas as fontes)"
          value={stats.leads}
          trend={trend((s) => s.leads)}
          hint={bySource.length > 1 ? bySource.map((s) => `${s.leads} ${sourceLabel(s.source)}`).join(" · ") : bySource[0] && sourceLabel(bySource[0].source)}
        />
        <Tile label="Visitantes na LP" value={stats.visitors} trend={trend((s) => s.visitors)} />
        <Tile label="Clicaram no WhatsApp" value={stats.clicks} trend={trend((s) => s.clicks)} />
        <Tile
          label="Com telefone"
          value={stats.with_phone}
          trend={trend((s) => s.with_phone)}
          hint={stats.leads ? `${stats.leads - stats.with_phone} a preencher` : undefined}
        />
        <Tile label="Vendas" value={stats.sales} trend={trend((s) => s.sales)} hint={stats.sales ? formatMoney(stats.revenue) : undefined} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {Object.entries(period.query).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <select name="status" defaultValue={status} className={`${controlClass} sm:w-40`} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(STATUSES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select name="fonte" defaultValue={source} className={`${controlClass} sm:w-44`} aria-label="Fonte">
            <option value="">Todas as fontes</option>
            {Object.entries(SOURCE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select name="origem" defaultValue={channel} className={`${controlClass} sm:w-44`} aria-label="Origem">
            <option value="">Todas as origens</option>
            {Object.entries(CHANNELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Código, nome, telefone, campanha" className={`${controlClass} col-span-2 sm:w-64`} />
          <button className={`${buttonClass("secondary")} col-span-2 sm:col-span-1`}>Filtrar</button>
        </form>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <NewLeadForm slug={slug} />
          <a href={`/w/${slug}/exportar?${exportQuery}`} className={buttonClass("secondary")}>
            Exportar CSV
          </a>
        </div>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState title={q || status || channel || source ? "Nenhum lead com esses filtros" : "Nenhum lead ainda"}>
          {!(q || status || channel || source) &&
            "Assim que um lead chegar (clique no WhatsApp da LP, formulário ou planilha), a linha aparece aqui."}
        </EmptyState>
      ) : (
        <>
          <LeadSheet leads={list.rows} lpEvents={lpEvents} />
          <p className="text-xs text-zinc-500">
            {list.total} {list.total === 1 ? "linha" : "linhas"}
            {list.total > list.rows.length && ` (mostrando as ${list.rows.length} mais recentes; exporte para ver todas)`}.
            A planilha se atualiza sozinha a cada 15 segundos. Clique numa célula para editar.
          </p>
        </>
      )}
    </div>
  );
}
