import Link from "next/link";
import { Badge, buttonClass, controlClass, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { channelLabel } from "@/lib/attribution";
import { call } from "@/lib/db";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { COLORS, isColor, isStatus, STATUSES } from "@/lib/leads";
import { SOURCE_LABELS, sourceLabel } from "@/lib/source-labels";

interface AllLead {
  id: string;
  client_id: string;
  client_name: string;
  client_slug: string;
  code: string;
  name: string | null;
  phone: string | null;
  status: string;
  color: string | null;
  source: string;
  channel: string | null;
  campaign: string | null;
  sale_value: number | string | null;
  created_at: string;
}

interface AllLeads {
  total: number;
  by_client: { id: string; name: string; count: number }[];
  leads: AllLead[];
}

const PERIODS = { "1": "Hoje e ontem", "7": "Últimos 7 dias", "30": "Últimos 30 dias", "90": "Últimos 90 dias", "0": "Tudo" } as const;
const STEP = 100;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const statusTone = (status: string) => (status === "venda" ? "good" : status === "agendado" ? "warn" : status === "perdido" ? "bad" : "neutral");

/** Every lead of the admin's clients in one list (read-only; changes happen in each client's panel). */
export default async function AllLeadsPage({ searchParams }: PageProps<"/admin/leads">) {
  const { token } = await requireAdmin();
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const search = one("busca").trim().slice(0, 100);
  const client = UUID_RE.test(one("cliente")) ? one("cliente") : "";
  const status = isStatus(one("status")) ? one("status") : "";
  const source = Object.hasOwn(SOURCE_LABELS, one("origem")) ? one("origem") : "";
  const period = Object.hasOwn(PERIODS, one("periodo")) ? (one("periodo") as keyof typeof PERIODS) : "30";
  const limit = Math.min(500, Math.max(STEP, Number.parseInt(one("mostrar"), 10) || STEP));

  const [data, clients] = await Promise.all([
    call<AllLeads>("lh_admin_all_leads", {
      p_token: token,
      p_filters: { search, client, status, source, days: Number(period), limit },
    }),
    call<{ id: string; name: string }[]>("lh_admin_list_workspaces", { p_token: token }),
  ]);
  const query = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ busca: search, cliente: client, status, origem: source, periodo: period, ...patch });
    for (const [k, v] of [...next.entries()]) if (!v) next.delete(k);
    const text = next.toString();
    return text ? `/admin/leads?${text}` : "/admin/leads";
  };
  const filtered = Boolean(search || client || status || source);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Leads de todos os clientes</h1>
        <p className="text-sm text-zinc-600">
          {data.total} {data.total === 1 ? "lead" : "leads"} · {PERIODS[period].toLowerCase()}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/admin/leads">
        <input
          name="busca"
          defaultValue={search}
          placeholder="Nome, telefone ou código"
          className={`${controlClass} min-w-0 flex-1 basis-56`}
          aria-label="Buscar"
        />
        <select name="cliente" defaultValue={client} className={controlClass} aria-label="Cliente">
          <option value="">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className={controlClass} aria-label="Status">
          <option value="">Todos os status</option>
          {Object.entries(STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="origem" defaultValue={source} className={controlClass} aria-label="Entrada">
          <option value="">Todas as entradas</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select name="periodo" defaultValue={period} className={controlClass} aria-label="Período">
          {Object.entries(PERIODS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className={buttonClass()}>Filtrar</button>
        {filtered && (
          <Link href={query({ busca: "", cliente: "", status: "", origem: "" })} className={buttonClass("secondary")}>
            Limpar
          </Link>
        )}
      </form>

      {!client && data.by_client.length > 1 && (
        <div className="hidden flex-wrap gap-1.5 text-sm md:flex">
          {data.by_client.map((c) => (
            <Link key={c.id} href={query({ cliente: c.id })} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 hover:border-zinc-400">
              {c.name} <span className="font-semibold">{c.count}</span>
            </Link>
          ))}
        </div>
      )}

      {data.leads.length === 0 ? (
        <EmptyState title="Nenhum lead encontrado">
          {filtered ? "Mude os filtros ou o período." : "Os leads dos clientes aparecem aqui assim que chegarem."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.leads.map((l) => (
              <li key={l.id} className={`rounded-lg border border-l-4 border-zinc-200 bg-white p-3 ${isColor(l.color) ? COLORS[l.color].border : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name || "Sem nome"}</div>
                    <Link href={`/admin/clientes/${l.client_id}`} className="text-xs text-zinc-500 underline-offset-2 hover:underline">
                      {l.client_name}
                    </Link>
                  </div>
                  <Badge tone={statusTone(l.status)}>{STATUSES[l.status as keyof typeof STATUSES] ?? l.status}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                  <span>{formatDateTime(l.created_at)}</span>
                  <Phone phone={l.phone} />
                  <span>{sourceLabel(l.source)}</span>
                  {l.status === "venda" && l.sale_value !== null && <span className="font-medium text-emerald-700">{formatMoney(l.sale_value)}</span>}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Chegou</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Telefone</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Entrada</th>
                  <th className="px-3 py-2 font-medium">Campanha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.leads.map((l) => (
                  <tr key={l.id} className={isColor(l.color) ? COLORS[l.color].row : undefined}>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{formatDateTime(l.created_at)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/clientes/${l.client_id}`} className="underline-offset-2 hover:underline">
                        {l.client_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {isColor(l.color) && <span className={`size-2 shrink-0 rounded-full ${COLORS[l.color].dot}`} title={COLORS[l.color].label} />}
                        <span className="font-medium">{l.name || "Sem nome"}</span>
                        <span className="font-mono text-xs text-zinc-400">{l.code}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Phone phone={l.phone} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge tone={statusTone(l.status)}>{STATUSES[l.status as keyof typeof STATUSES] ?? l.status}</Badge>
                      {l.status === "venda" && l.sale_value !== null && (
                        <span className="ml-1.5 text-xs font-medium text-emerald-700">{formatMoney(l.sale_value)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {sourceLabel(l.source)}
                      {l.source === "lp" && l.channel && <div className="text-xs text-zinc-500">{channelLabel(l.channel)}</div>}
                    </td>
                    <td className="max-w-56 truncate px-3 py-2 text-zinc-600" title={l.campaign ?? undefined}>
                      {l.campaign ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.total > data.leads.length && (
            <div className="flex items-center justify-center gap-3 text-sm text-zinc-600">
              <span>
                Mostrando {data.leads.length} de {data.total}
              </span>
              {limit < 500 && (
                <Link href={query({ mostrar: String(limit + STEP) })} className={buttonClass("secondary")} scroll={false}>
                  Ver mais
                </Link>
              )}
            </div>
          )}
        </>
      )}
      <p className="text-xs text-zinc-500">
        Só para consulta. Para atender, mudar status ou cor, abra o cliente e entre no painel dele.
      </p>
    </div>
  );
}

function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-zinc-400">sem telefone</span>;
  const digits = phone.replace(/\D/g, "");
  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline-offset-2 hover:underline">
      {formatPhone(phone)}
    </a>
  );
}
