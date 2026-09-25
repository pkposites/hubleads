import Link from "next/link";
import { buttonClass, EmptyState } from "@/components/ui";
import { requireAdmin, type ClientSummary } from "@/lib/admin";
import { call } from "@/lib/db";
import { formatDateTime, isWithinDays, timeSince } from "@/lib/format";

export default async function AdminHome() {
  const { token } = await requireAdmin();
  const clients = await call<ClientSummary[]>("lh_admin_list_workspaces", { p_token: token });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clientes</h1>
        <Link href="/admin/novo" className={buttonClass()}>
          + Novo cliente
        </Link>
      </div>
      {clients.length === 0 ? (
        <EmptyState title="Nenhum cliente ainda">Crie o primeiro para gerar o código da LP e a senha do atendente.</EmptyState>
      ) : (
        <>
        <ul className="flex flex-col gap-2 md:hidden">
          {clients.map((c) => {
            const active = isWithinDays(c.last_event_at, 3);
            return (
              <li key={c.id}>
                <Link href={`/admin/clientes/${c.id}`} className="block rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-zinc-500">/w/{c.slug}</div>
                    </div>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${active ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                      {active ? "Recebendo dados" : c.last_event_at ? "Sem dados há 3+ dias" : "Aguardando instalação"}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-600">
                    <div>
                      <dt>Leads 7 dias</dt>
                      <dd className="text-sm font-medium text-zinc-900">{c.leads_7d}</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd className="text-sm font-medium text-zinc-900">{c.leads_total}</dd>
                    </div>
                    <div>
                      <dt>Sem telefone</dt>
                      <dd className="text-sm font-medium text-zinc-900">{c.without_phone}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                {["Cliente", "Landing Pages", "Leads 7 dias", "Leads total", "Sem telefone", "Último lead", "LP ativa?"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {clients.map((c) => {
                const active = isWithinDays(c.last_event_at, 3);
                return (
                  <tr key={c.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2">
                      <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-zinc-500">/w/{c.slug}</div>
                    </td>
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
                      {active ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Recebendo dados</span>
                      ) : (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                          {c.last_event_at ? "Sem dados há 3+ dias" : "Aguardando instalação"}
                        </span>
                      )}
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
