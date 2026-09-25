import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, EmptyState } from "@/components/ui";
import { appOrigin, installPrompt, requireAdmin, snippet, type ClientSummary } from "@/lib/admin";
import { channelLabel } from "@/lib/attribution";
import { call, DbError } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { LeadEvent } from "@/lib/leads";
import { openClientSheet } from "../../../actions";
import { encryptionKey, serverSecret } from "@/lib/server";
import { AddPageForm, PageSettings, ResetPassword } from "./client-actions";
import { MetaSettings, type MetaSettingsData } from "./meta-settings";

const TYPE_LABEL: Record<string, string> = {
  page_view: "Visita",
  whatsapp_click: "Clique no WhatsApp",
  identify: "Contato informado",
};

export default async function ClientPage({ params }: PageProps<"/admin/clientes/[id]">) {
  const { id } = await params;
  const { token } = await requireAdmin();

  let client: ClientSummary;
  try {
    client = await call<ClientSummary>("lh_admin_workspace", { p_token: token, p_workspace_id: id });
  } catch (error) {
    if (error instanceof DbError && (error.code === "LH404" || error.code === "22P02")) notFound();
    throw error;
  }
  const [events, meta] = await Promise.all([
    call<LeadEvent[]>("lh_admin_list_events", { p_token: token, p_workspace_id: id, p_limit: 50 }),
    call<MetaSettingsData>("lh_admin_get_meta", { p_token: token, p_workspace_id: id }),
  ]);
  const origin = await appOrigin();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{client.name}</h1>
          <p className="text-sm text-zinc-600">
            {client.leads_total} leads · {client.leads_7d} nos últimos 7 dias · {client.without_phone} sem telefone
          </p>
        </div>
        <form action={openClientSheet.bind(null, client.id)}>
          <Button>Abrir planilha do cliente</Button>
        </form>
      </div>

      <Card title="Acesso do atendente">
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Link: <code className="font-mono">{`${origin}/w/${client.slug}`}</code>
          </p>
          <p className="text-zinc-600">
            A senha só aparece quando é gerada. Se o cliente perdeu, gere outra: a antiga deixa de funcionar na hora.
          </p>
          <ResetPassword origin={origin} id={client.id} name={client.name} slug={client.slug} />
        </div>
      </Card>

      {client.pages.map((page) => (
        <Card key={page.id} title={`Landing Page: ${page.name}`}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Código para colar no &lt;head&gt; da LP</span>
                <CopyButton text={snippet(origin, page)} label="Copiar código" />
              </div>
              <pre className="overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-100">{snippet(origin, page)}</pre>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Prompt de instalação (para o Claude Code da LP)</span>
                <CopyButton text={installPrompt(origin, page)} label="Copiar prompt" />
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                {installPrompt(origin, page)}
              </pre>
            </div>
            <PageSettings workspaceId={client.id} page={page} />
          </div>
        </Card>
      ))}

      <Card title="Conversões para a Meta (API de Conversões)">
        <MetaSettings workspaceId={client.id} data={meta} serverReady={{ secret: Boolean(serverSecret()), key: Boolean(encryptionKey()) }} />
      </Card>

      <Card title="Adicionar outra Landing Page">
        <AddPageForm workspaceId={client.id} />
      </Card>

      <Card title="Eventos recentes das LPs">
        {events.length === 0 ? (
          <EmptyState title="Nenhum evento recebido ainda">Depois de instalar o código, as visitas aparecem aqui.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  {["Quando", "Evento", "Origem", "Campanha", "Cód.", "Dispositivo", "Página"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatDateTime(e.created_at)}</td>
                    <td className="px-2 py-1.5">{TYPE_LABEL[e.type] ?? e.type}</td>
                    <td className="px-2 py-1.5">{channelLabel(e.data.channel)}</td>
                    <td className="px-2 py-1.5 text-xs">{e.data.utm_campaign ?? "—"}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{e.data.code ?? ""}</td>
                    <td className="px-2 py-1.5 text-xs">{e.data.device ?? ""}</td>
                    <td className="max-w-72 truncate px-2 py-1.5 text-xs text-zinc-600" title={e.url ?? undefined}>
                      {e.url ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
