import { EmptyState } from "@/components/ui";
import { channelLabel } from "@/lib/attribution";
import { call } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { LeadEvent } from "@/lib/leads";
import { requireWorkspace } from "@/lib/session";
import { AutoRefresh } from "../auto-refresh";

const TYPE_LABEL: Record<string, string> = {
  page_view: "Visita",
  whatsapp_click: "Clique no WhatsApp",
  identify: "Nome informado",
};

export default async function EventsPage({ params }: PageProps<"/w/[slug]/eventos">) {
  const { slug } = await params;
  const { token } = await requireWorkspace(slug);
  const events = await call<LeadEvent[]>("lh_list_events", { p_token: token, p_limit: 200 });

  return (
    <div className="flex flex-col gap-3">
      <AutoRefresh seconds={10} />
      <div>
        <h1 className="text-lg font-semibold">Eventos recebidos da LP</h1>
        <p className="text-sm text-zinc-600">Os 200 mais recentes, em tempo real. Útil para conferir se a instalação está funcionando.</p>
      </div>
      {events.length === 0 ? (
        <EmptyState title="Nenhum evento recebido ainda">Abra a LP com o código instalado e ele aparece aqui.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                {["Quando", "Evento", "Visitante", "Origem", "Campanha", "Cód.", "Dispositivo", "Página"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">{formatDateTime(e.created_at)}</td>
                  <td className="px-3 py-1.5">{TYPE_LABEL[e.type] ?? e.type}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-zinc-500">{e.visitor_id?.slice(0, 8)}</td>
                  <td className="px-3 py-1.5">{channelLabel(e.data.channel)}</td>
                  <td className="px-3 py-1.5 text-xs">{e.data.utm_campaign ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{e.data.code ?? ""}</td>
                  <td className="px-3 py-1.5 text-xs">{e.data.device ?? ""}</td>
                  <td className="max-w-72 truncate px-3 py-1.5 text-xs text-zinc-600" title={e.url ?? undefined}>
                    {e.url ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
