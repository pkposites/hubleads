import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/ui";
import { requireAdmin, type ClientSummary } from "@/lib/admin";
import { call } from "@/lib/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AlertMode } from "@/components/dismissible-alert";
import { ACTIVITY_LABEL, clientActivity, idleClients } from "@/lib/client-alerts";
import { formatDateTime, timeSince } from "@/lib/format";
import { dbLimitMb, evaluateInfra, type InfraNumbers } from "@/lib/infra";
import { IdleAlert } from "./idle-alert";
import { InfraAlert } from "./infra-alert";
import { Signups, type Signup } from "./signups";

const ACTIVITY_DOT = { recebendo: "bg-emerald-500", parado: "bg-amber-500", aguardando: "bg-zinc-300" } as const;

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const { token, role, team } = await requireAdmin();
  if (team) redirect(`/admin/clientes/${team.id}`);
  const deleted = (await searchParams).apagado;
  const isMaster = role === "master";
  const [clients, infra, signups] = await Promise.all([
    call<ClientSummary[]>("lh_admin_list_workspaces", { p_token: token }),
    isMaster ? call<InfraNumbers>("lh_admin_infra", { p_token: token }).catch(() => null) : null,
    isMaster ? call<Signup[]>("lh_admin_list_signups", { p_token: token }).catch(() => [] as Signup[]) : ([] as Signup[]),
  ]);
  // Alerts the admin minimised or hid (only while they say the same thing).
  const store = await cookies();
  const modeOf = (id: string) => (signature: string): AlertMode => {
    const [mode, sig] = (store.get(`lh_alert_${id}`)?.value ?? "").split(".");
    return sig === signature && (mode === "min" || mode === "hide") ? mode : "open";
  };
  // A person of a single client goes straight to it.
  if (role === "conta" && clients.length === 1) redirect(`/admin/clientes/${clients[0].id}`);
  const now = new Date();
  const idle = idleClients(clients, now);
  // Most recent activity first: the clients that matter today are on top.
  const lastActivity = (c: ClientSummary) => [c.last_lead_at, c.last_event_at, c.created_at].filter(Boolean).sort().at(-1) ?? "";
  const sorted = [...clients].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  const totals = {
    week: clients.reduce((n, c) => n + c.leads_7d, 0),
    all: clients.reduce((n, c) => n + c.leads_total, 0),
    active: clients.filter((c) => clientActivity(c, now) === "recebendo").length,
  };

  return (
    <div className="flex flex-col gap-4">
      {typeof deleted === "string" && deleted && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          Cliente &quot;{deleted}&quot; apagado.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: "Leads nos últimos 7 dias", value: totals.week },
          { label: "Leads no total", value: totals.all },
          { label: "Clientes recebendo dados", value: `${totals.active} de ${clients.length}` },
          { label: "Sem lead novo há +20 h", value: idle.length, warn: idle.length > 0 },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
            <dt className="text-xs text-zinc-500">{k.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${k.warn ? "text-amber-700" : "text-zinc-900"}`}>{k.value}</dd>
          </div>
        ))}
      </dl>
      <Signups signups={signups} />
      <IdleAlert clients={idle} mode={modeOf("parados")} />
      {infra && <InfraAlert status={evaluateInfra(infra, dbLimitMb())} numbers={infra} mode={modeOf("banco")} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clientes</h1>
        {role !== "conta" && (
          <Link href="/admin/novo" className={`${buttonClass()} hidden md:inline-flex`}>
            + Novo cliente
          </Link>
        )}
      </div>
      {clients.length === 0 ? (
        <EmptyState title="Nenhum cliente ainda">
          {role === "conta" ? "Nenhum cliente foi liberado para você ainda." : "Crie o primeiro para gerar o código da LP e a senha do atendente."}
        </EmptyState>
      ) : (
        <>
        <ul className="flex flex-col gap-2 md:hidden">
          {sorted.map((c) => {
            const activity = clientActivity(c, now);
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/clientes/${c.id}`}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition active:scale-[0.99] active:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 shrink-0 rounded-full ${ACTIVITY_DOT[activity]}`} title={ACTIVITY_LABEL[activity]} />
                      <span className="truncate font-medium">{c.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {activity === "recebendo"
                        ? c.last_lead_at
                          ? `Último lead ${timeSince(c.last_lead_at, now)}`
                          : "Recebendo visitas, sem lead ainda"
                        : ACTIVITY_LABEL[activity]}
                      {isMaster && c.owner_login ? ` · ${c.owner_login}` : ""}
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                      <span>
                        <strong className="text-sm font-semibold text-zinc-900 tabular-nums">{c.leads_7d}</strong> em 7 dias
                      </span>
                      <span>
                        <strong className="text-sm font-semibold text-zinc-900 tabular-nums">{c.leads_total}</strong> no total
                      </span>
                      {c.without_phone > 0 && (
                        <span>
                          <strong className="text-sm font-semibold text-zinc-900 tabular-nums">{c.without_phone}</strong> sem tel.
                        </span>
                      )}
                    </div>
                  </div>
                  <span aria-hidden className="text-xl text-zinc-300">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                {["Cliente", ...(isMaster ? ["Gestor"] : []), "Landing Pages", "Leads 7 dias", "Leads total", "Sem telefone", "Último lead", "Entrada de dados"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sorted.map((c) => {
                const activity = clientActivity(c, now);
                return (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <Link href={`/admin/clientes/${c.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <span className={`size-2 shrink-0 rounded-full ${ACTIVITY_DOT[activity]}`} />
                        {c.name}
                      </Link>
                      <div className="text-xs text-zinc-500">/w/{c.slug}</div>
                    </td>
                    {isMaster && <td className="px-3 py-2 text-xs">{c.owner_login ?? <span className="text-zinc-500">Você</span>}</td>}
                    <td className="px-3 py-2">{c.pages.length}</td>
                    <td className="px-3 py-2 tabular-nums">{c.leads_7d}</td>
                    <td className="px-3 py-2 tabular-nums">{c.leads_total}</td>
                    <td className="px-3 py-2 tabular-nums">{c.without_phone}</td>
                    <td className="px-3 py-2 text-xs">
                      {c.last_lead_at ? (
                        <>
                          <div>{formatDateTime(c.last_lead_at)}</div>
                          <div className="text-zinc-500">{timeSince(c.last_lead_at)}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`rounded px-1.5 py-0.5 ${activity === "recebendo" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
                      >
                        {ACTIVITY_LABEL[activity]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
