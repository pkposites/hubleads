import Link from "next/link";
import { buttonClass, controlClass, EmptyState } from "@/components/ui";
import { CHANNELS } from "@/lib/attribution";
import { call } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { formatRate, isStatus, PERIODS, periodStart, rate, STATUSES, type Lead, type Stats } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { AutoRefresh } from "./auto-refresh";
import { LeadSheet } from "./lead-sheet";
import { NewLeadForm } from "./new-lead-form";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export default async function SheetPage({ params, searchParams }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = first(sp.periodo) in PERIODS ? first(sp.periodo) : "30d";
  const status = isStatus(first(sp.status)) ? first(sp.status) : "";
  const channel = first(sp.origem) in CHANNELS ? first(sp.origem) : "";
  const q = first(sp.q).trim().slice(0, 100);

  const { token, workspace } = await requireWorkspace(slug);
  const since = periodStart(period)?.toISOString() ?? null;

  const [stats, list] = await Promise.all([
    call<Stats>("lh_stats", { p_token: token, p_since: since }),
    call<{ total: number; rows: Lead[] }>("lh_list_leads", {
      p_token: token,
      p_since: since,
      p_status: status || null,
      p_channel: channel || null,
      p_search: q || null,
      p_limit: 500,
      p_offset: 0,
    }),
  ]);

  const exportQuery = new URLSearchParams({ periodo: period, ...(status && { status }), ...(channel && { origem: channel }), ...(q && { q }) });

  return (
    <div className="flex flex-col gap-4">
      <AutoRefresh />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-5">
        <Link
          href={`/w/${slug}/metricas?periodo=${period}`}
          className="col-span-2 rounded-lg border border-[#2a78d6]/30 bg-[#2a78d6]/5 px-3 py-2.5 hover:bg-[#2a78d6]/10 sm:px-4 sm:py-3 md:col-span-1"
        >
          <div className="text-xs text-zinc-600">Taxa de conversão</div>
          <div className="text-2xl font-semibold">{formatRate(rate(stats.clicks, stats.visitors))}</div>
          <div className="text-xs text-zinc-600">Ver métricas →</div>
        </Link>
        <Tile label="Visitantes na LP" value={stats.visitors} />
        <Tile label="Clicaram no WhatsApp" value={stats.clicks} />
        <Tile label="Com telefone" value={stats.with_phone} hint={stats.leads ? `${stats.leads - stats.with_phone} a preencher` : undefined} />
        <Tile label="Vendas" value={stats.sales} hint={stats.sales ? formatMoney(stats.revenue) : undefined} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <select name="periodo" defaultValue={period} className={`${controlClass} sm:w-32`} aria-label="Período">
            {Object.entries(PERIODS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className={`${controlClass} sm:w-40`} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(STATUSES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select name="origem" defaultValue={channel} className={`${controlClass} col-span-2 sm:w-44`} aria-label="Origem">
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
        <EmptyState title={q || status || channel ? "Nenhum lead com esses filtros" : "Nenhum clique no WhatsApp ainda"}>
          {!(q || status || channel) &&
            "Assim que alguém clicar no WhatsApp da Landing Page, a linha aparece aqui em segundos."}
        </EmptyState>
      ) : (
        <>
          <LeadSheet slug={slug} leads={list.rows} canDelete={workspace.role === "admin"} />
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
