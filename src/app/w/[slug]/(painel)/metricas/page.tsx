import { channelLabel } from "@/lib/attribution";
import { call } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import {
  DIMENSIONS,
  formatRate,
  PERIODS,
  periodStart,
  rate,
  type Dimension,
  type Metrics,
  type MetricsRow,
} from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { AutoRefresh } from "../auto-refresh";
import { PillLinks } from "../period-tabs";
import { DailyCharts } from "./daily-charts";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Meter: accent fill on a lighter step of the same hue. */
function Meter({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#cde2fb]" role="meter" aria-label={label} aria-valuenow={value ?? 0} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${value ?? 0}%` }} />
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function rowLabel(dimension: Dimension, key: string) {
  if (!key) return "Não informado";
  if (dimension === "channel") return channelLabel(key);
  if (dimension === "device") return { mobile: "Celular", desktop: "Computador", tablet: "Tablet" }[key] ?? key;
  return key;
}

export default async function MetricsPage({ params, searchParams }: PageProps<"/w/[slug]/metricas">) {
  const { slug } = await params;
  const sp = await searchParams;
  const period = first(sp.periodo) in PERIODS ? first(sp.periodo) : "30d";
  const dimension = (first(sp.por) in DIMENSIONS ? first(sp.por) : "channel") as Dimension;
  const { token } = await requireWorkspace(slug);

  const metrics = await call<Metrics>("lh_metrics", {
    p_token: token,
    p_since: periodStart(period)?.toISOString() ?? null,
    p_dimension: dimension,
  });
  const t = metrics.totals;
  const conversion = rate(t.clickers, t.visitors);
  const href = (changes: Record<string, string>) =>
    `/w/${slug}/metricas?${new URLSearchParams({ periodo: period, por: dimension, ...changes })}`;

  const funnel: { label: string; value: number; hint?: string }[] = [
    { label: "Visitaram a LP", value: t.visitors },
    { label: "Clicaram no WhatsApp", value: t.clickers },
    { label: "Com telefone", value: t.with_phone },
    { label: "Agendaram", value: t.scheduled },
    { label: "Compraram", value: t.sales, hint: t.sales ? formatMoney(t.revenue) : undefined },
  ];
  const top = Math.max(t.visitors, 1);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <AutoRefresh seconds={30} />
      <PillLinks label="Período" options={PERIODS} active={period} href={(k) => href({ periodo: k })} />

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="text-sm text-zinc-600">Taxa de conversão da LP</div>
        <div className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">{formatRate(conversion)}</div>
        <p className="mt-1 text-sm text-zinc-600">
          {t.visitors === 0
            ? "Ainda não há visitas neste período."
            : `${t.clickers} de ${t.visitors} ${t.visitors === 1 ? "visitante clicou" : "visitantes clicaram"} no WhatsApp`}
        </p>
        <div className="mt-4">
          <Meter value={conversion} label="Taxa de conversão" />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Visitantes" value={t.visitors.toLocaleString("pt-BR")} />
        <Tile
          label="Clicaram no WhatsApp"
          value={t.clickers.toLocaleString("pt-BR")}
          hint={t.clicks > t.clickers ? `${t.clicks} cliques no total` : undefined}
        />
        <Tile label="Com telefone" value={t.with_phone} hint={`${formatRate(rate(t.with_phone, t.leads))} dos leads`} />
        <Tile
          label="Vendas"
          value={t.sales}
          hint={t.sales ? `${formatMoney(t.revenue)} · ${formatRate(rate(t.sales, t.visitors))} dos visitantes` : undefined}
        />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold">Funil</h2>
        <ol className="flex flex-col gap-3">
          {funnel.map((step, i) => {
            const prev = i > 0 ? funnel[i - 1].value : null;
            return (
              <li key={step.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className="text-sm text-zinc-700">{step.label}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {step.value.toLocaleString("pt-BR")}
                  {step.hint && <span className="ml-1 font-normal text-zinc-500">· {step.hint}</span>}
                </span>
                <div className="col-span-2 h-3 rounded-sm bg-zinc-100">
                  <div
                    className="h-full rounded-r-[4px] bg-[#2a78d6]"
                    style={{ width: `${Math.max((step.value / top) * 100, step.value ? 1 : 0)}%` }}
                  />
                </div>
                {prev !== null && (
                  <span className="col-span-2 text-xs text-zinc-500">
                    {formatRate(rate(step.value, prev))} da etapa anterior · {formatRate(rate(step.value, t.visitors))} dos visitantes
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {t.manual_leads > 0 && (
          <p className="mt-4 text-xs text-zinc-500">
            + {t.manual_leads} {t.manual_leads === 1 ? "lead adicionado" : "leads adicionados"} à mão (fora do funil da LP).
          </p>
        )}
      </section>

      {metrics.daily.length > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <DailyCharts days={metrics.daily} />
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Aproveitamento por {DIMENSIONS[dimension].toLowerCase()}</h2>
        <PillLinks label="Agrupar por" options={DIMENSIONS} active={dimension} href={(k) => href({ por: k })} />
        {metrics.rows.length === 0 ? (
          <p className="text-sm text-zinc-500">Sem dados neste período.</p>
        ) : (
          <>
            {/* Phones: one card per row. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {metrics.rows.map((r) => (
                <BreakdownCard key={r.key} dimension={dimension} row={r} />
              ))}
            </ul>
            {/* Larger screens: a table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">{DIMENSIONS[dimension]}</th>
                    <th className="py-2 pr-4 text-right font-medium">Visitantes</th>
                    <th className="py-2 pr-4 text-right font-medium">Clicaram</th>
                    <th className="w-56 py-2 pr-4 font-medium">Conversão</th>
                    <th className="py-2 pr-4 text-right font-medium">Com telefone</th>
                    <th className="py-2 pr-4 text-right font-medium">Agendaram</th>
                    <th className="py-2 pr-4 text-right font-medium">Vendas</th>
                    <th className="py-2 text-right font-medium">Faturamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 tabular-nums">
                  {metrics.rows.map((r) => {
                    const conv = rate(r.clickers, r.visitors);
                    return (
                      <tr key={r.key}>
                        <td className="max-w-64 break-words py-2 pr-4">{rowLabel(dimension, r.key)}</td>
                        <td className="py-2 pr-4 text-right">{r.visitors}</td>
                        <td className="py-2 pr-4 text-right">{r.clickers}</td>
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-right">{formatRate(conv)}</span>
                            <div className="flex-1">
                              <Meter value={conv} label={`Conversão de ${rowLabel(dimension, r.key)}`} />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right">{r.with_phone}</td>
                        <td className="py-2 pr-4 text-right">{r.scheduled}</td>
                        <td className="py-2 pr-4 text-right">{r.sales}</td>
                        <td className="py-2 text-right">{r.revenue ? formatMoney(r.revenue) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-xs text-zinc-500">
          Conversão = pessoas que clicaram no WhatsApp ÷ pessoas que visitaram. Cliques repetidos da mesma pessoa contam uma vez.
        </p>
      </section>
    </div>
  );
}

function BreakdownCard({ dimension, row }: { dimension: Dimension; row: MetricsRow }) {
  const conv = rate(row.clickers, row.visitors);
  return (
    <li className="rounded-md border border-zinc-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="break-words font-medium">{rowLabel(dimension, row.key)}</span>
        <span className="shrink-0 text-lg font-semibold">{formatRate(conv)}</span>
      </div>
      <div className="mt-2">
        <Meter value={conv} label={`Conversão de ${rowLabel(dimension, row.key)}`} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-600">
        <div>
          <dt>Visitantes</dt>
          <dd className="text-sm font-medium text-zinc-900">{row.visitors}</dd>
        </div>
        <div>
          <dt>Clicaram</dt>
          <dd className="text-sm font-medium text-zinc-900">{row.clickers}</dd>
        </div>
        <div>
          <dt>Vendas</dt>
          <dd className="text-sm font-medium text-zinc-900">
            {row.sales}
            {row.revenue ? <span className="block text-xs font-normal text-zinc-500">{formatMoney(row.revenue)}</span> : null}
          </dd>
        </div>
      </dl>
    </li>
  );
}
