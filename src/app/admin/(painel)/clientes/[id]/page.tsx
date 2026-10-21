import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { appOrigin, installPrompt, requireAdmin, snippet, type AdminUser, type ClientSummary } from "@/lib/admin";
import { channelLabel } from "@/lib/attribution";
import { call, DbError } from "@/lib/db";
import { formatDateTime, timeSince } from "@/lib/format";
import type { LeadEvent } from "@/lib/leads";
import { eventLabel } from "@/lib/lp-events";
import { openClientSheet } from "../../../actions";
import { encryptionKey, serverSecret } from "@/lib/server";
import { AddPageForm, DeleteClient, OwnerForm, PageSettings, ResetPassword } from "./client-actions";
import { MetaSettings, type MetaSettingsData } from "./meta-settings";
import { PrivacySettings } from "./privacy-settings";
import { LeadForms, type LeadFormsData } from "./lead-forms";
import { SheetSources, type SheetSource } from "./sheet-sources";
import { GoogleAds } from "./google-ads";
import { Members, TeamAccess, type Member } from "./members";
import type { GoogleAdsSettings } from "@/lib/google-ads";
import type { PrivacySettings as PrivacyData } from "@/lib/privacy";

const TYPE_LABEL: Record<string, string> = {
  page_view: "Visita",
  whatsapp_click: "Clique no WhatsApp",
  form_submit: "Formulário enviado",
  identify: "Contato informado",
};

function eventName(e: LeadEvent) {
  if (e.type === "lp_event") {
    const inner = e.data.data as { event?: string; source?: string } | undefined;
    const source = { pixel: "pixel", gtm: "GTM", gtag: "gtag", api: "Cadê o Lead" }[inner?.source ?? ""];
    return `${eventLabel(inner?.event ?? "evento")}${source ? ` (${source})` : ""}`;
  }
  return TYPE_LABEL[e.type] ?? eventLabel(e.type);
}

const TABS = [
  { key: "visao", label: "Visão geral" },
  { key: "fontes", label: "Fontes de leads" },
  { key: "conversoes", label: "Meta e Google" },
  { key: "acessos", label: "Acessos" },
  { key: "privacidade", label: "Privacidade" },
  { key: "atividade", label: "Atividade" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Status = "ok" | "warn" | "off" | "todo";
const STATUS_BADGE: Record<Status, { tone: "good" | "warn" | "neutral" | "bad"; label: string }> = {
  ok: { tone: "good", label: "Funcionando" },
  warn: { tone: "warn", label: "Atenção" },
  off: { tone: "neutral", label: "Opcional" },
  todo: { tone: "bad", label: "Falta configurar" },
};

const HOUR = 3_600_000;
const olderThan = (iso: string | null | undefined, hours: number, now: Date) => !iso || now.getTime() - new Date(iso).getTime() > hours * HOUR;

/** One step of the setup: what it is, how it is doing and where to fix it. */
function StepRow({ status, title, detail, href, action }: { status: Status; title: string; detail: ReactNode; href: string; action: string }) {
  const badge = STATUS_BADGE[status];
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1 size-2.5 shrink-0 rounded-full ${
            status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : status === "todo" ? "bg-red-500" : "bg-zinc-300"
          }`}
        />
        <div>
          <p className="font-medium text-zinc-900">
            {title} <Badge tone={badge.tone}>{badge.label}</Badge>
          </p>
          <p className="text-sm text-zinc-600">{detail}</p>
        </div>
      </div>
      <Link href={href} className="shrink-0 self-start rounded-md border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 sm:self-center">
        {action}
      </Link>
    </li>
  );
}

/** Integration tile, like the app lists of CRM settings. */
function Tile({ status, title, summary, href }: { status: Status; title: string; summary: string; href: string }) {
  const badge = STATUS_BADGE[status];
  return (
    <a href={href} className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-zinc-900">{title}</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </span>
      <span className="text-sm text-zinc-600">{summary}</span>
    </a>
  );
}

export default async function ClientPage({ params, searchParams }: PageProps<"/admin/clientes/[id]">) {
  const { id } = await params;
  const requested = (await searchParams).aba;
  const { token, role, team } = await requireAdmin();
  const manages = role !== "conta";
  // The client's team (from the sheet) sees no access settings.
  const tabs = team ? TABS.filter((t) => t.key !== "acessos") : TABS;
  const tab: Tab = tabs.some((t) => t.key === requested) ? (requested as Tab) : "visao";

  // Everything at once: each call is a round trip to the database.
  const args = { p_token: token, p_workspace_id: id };
  // Unknown or someone else's client: every call answers "not found" the same way.
  const found = <T,>(promise: Promise<T>) =>
    promise.catch((error) => {
      if (error instanceof DbError && (error.code === "LH404" || error.code === "22P02")) return null;
      throw error;
    });
  const [client, eventList, meta, pixelList, privacy, leadForms, sourceList, googleAds, admins, memberList, teamAccess, origin] = await Promise.all([
    found(call<ClientSummary>("lh_admin_workspace", args)),
    found(call<LeadEvent[]>("lh_admin_list_events", { ...args, p_limit: 50 })),
    found(call<MetaSettingsData>("lh_admin_get_meta", args)),
    found(call<{ pixel_id: string; last_seen: string }[]>("lh_admin_lp_pixels", args)),
    found(call<PrivacyData>("lh_admin_get_privacy", args)),
    found(call<LeadFormsData>("lh_admin_get_lead_forms", args)),
    found(call<SheetSource[]>("lh_admin_list_sources", args)),
    found(call<GoogleAdsSettings | null>("lh_admin_get_google_ads", args)),
    role === "master" ? call<AdminUser[]>("lh_admin_list_admins", { p_token: token }) : Promise.resolve([] as AdminUser[]),
    manages ? found(call<Member[]>("lh_admin_list_members", args)) : Promise.resolve([] as Member[]),
    manages ? found(call<boolean>("lh_admin_get_team_access", args)) : Promise.resolve(false),
    appOrigin(),
  ]);
  if (!client || !meta || !privacy || !leadForms) notFound();
  const events = eventList ?? [];
  const pixels = pixelList ?? [];
  const sources = sourceList ?? [];
  const members = memberList ?? [];
  const gestores = admins.filter((a) => a.role === "gestor" && a.active);
  const now = new Date();
  const base = `/admin/clientes/${client.id}`;

  // --- status of each part ---------------------------------------------------
  const lastEventOf = (pageId: string) => events.find((e) => e.page_id === pageId)?.created_at ?? null;
  const lpStatus: Status = client.pages.length === 0 ? "todo" : !client.last_event_at ? "todo" : olderThan(client.last_event_at, 48, now) ? "warn" : "ok";
  const openDomains = client.pages.filter((p) => p.domains.length === 0).length;
  const sheetsStatus: Status = sources.length === 0 ? "off" : sources.some((s) => s.last_error) ? "warn" : "ok";
  const formsActive = leadForms.forms.filter((f) => f.enabled);
  const formsStatus: Status = formsActive.length === 0 ? "off" : formsActive.some((f) => f.last_error) ? "warn" : "ok";
  const metaStatus: Status = !meta.configured || !meta.enabled ? "todo" : meta.test_event_code || meta.failures_24h > 0 ? "warn" : "ok";
  const googleStatus: Status = !googleAds ? "off" : !googleAds.enabled ? "warn" : "ok";
  const privacyStatus: Status = privacy.controller && privacy.email ? "ok" : "todo";
  const metaDetail = !meta.configured
    ? "Sem pixel e token: Lead, Agendado e Venda não voltam para a Meta."
    : !meta.enabled
      ? "Configurado, mas o envio está desligado."
      : meta.test_event_code
        ? `Código de teste ligado (${meta.test_event_code}): os eventos vão como teste e não ajudam as campanhas. Apague o código quando terminar os testes.`
        : meta.failures_24h > 0
          ? `${meta.failures_24h} falha(s) de envio nas últimas 24 h.`
          : `Pixel ${meta.pixel_id} · ${[meta.send_schedule && "Agendado", meta.send_purchase && "Venda"].filter(Boolean).join(" e ") || "só Lead"} ${meta.last_ok_at ? `· último envio ${timeSince(meta.last_ok_at, now)}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      {manages && (
        <Link href="/admin" className="-mb-2 self-start text-sm text-zinc-500 hover:text-zinc-900">
          ‹ Clientes
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{client.name}</h1>
          <p className="text-sm text-zinc-600">
            {client.leads_total} leads · {client.leads_7d} nos últimos 7 dias · {client.without_phone} sem telefone
            {client.last_lead_at && ` · último lead ${timeSince(client.last_lead_at, now)}`}
          </p>
        </div>
        {!team && (
          <form action={openClientSheet.bind(null, client.id)}>
            <Button>Abrir planilha do cliente</Button>
          </form>
        )}
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-zinc-200 px-4 [scrollbar-width:none] md:mx-0 md:px-0" aria-label="Seções do cliente">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "visao" ? base : `${base}?aba=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition ${
              tab === t.key ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "visao" && (
        <>
          <Card title="Implantação">
            <ul className="-m-4 divide-y divide-zinc-100">
              <StepRow
                status={lpStatus}
                title="Landing Pages recebendo visitas"
                detail={
                  client.pages.length === 0
                    ? "Nenhuma Landing Page cadastrada."
                    : client.last_event_at
                      ? `${client.pages.length} ${client.pages.length === 1 ? "página" : "páginas"} · último dado ${timeSince(client.last_event_at, now)}${openDomains ? ` · ${openDomains} sem domínio liberado` : ""}`
                      : "Código ainda não instalado ou sem visitas: cole o código no <head> da LP."
                }
                href={`${base}?aba=fontes#lps`}
                action="Ver Landing Pages"
              />
              <StepRow
                status={metaStatus}
                title="Retorno para a Meta (API de Conversões)"
                detail={metaDetail}
                href={`${base}?aba=conversoes#meta`}
                action="Configurar Meta"
              />
              {!team && (
                <StepRow
                  status="ok"
                  title="Acesso do atendente"
                  detail={
                    <>
                      Planilha em <code className="font-mono text-xs">{`${origin}/w/${client.slug}`}</code>
                    </>
                  }
                  href={`${base}?aba=acessos`}
                  action="Ver acessos"
                />
              )}
              <StepRow
                status={privacyStatus}
                title="Privacidade (LGPD)"
                detail={privacy.controller ? `Responsável pelos dados: ${privacy.controller}` : "Falta o responsável pelos dados e o e-mail de contato da política."}
                href={`${base}?aba=privacidade`}
                action="Revisar"
              />
              <StepRow
                status={googleStatus}
                title="Google Ads (opcional)"
                detail={googleAds ? `Feed de conversões ${googleAds.enabled ? "ligado" : "desligado"}${googleAds.last_fetch_at ? ` · última busca ${timeSince(googleAds.last_fetch_at, now)}` : ""}` : "Só para quem anuncia no Google."}
                href={`${base}?aba=conversoes#google`}
                action="Configurar Google"
              />
            </ul>
          </Card>
          {role === "master" && (
            <Card title="Responsável (gestor)">
              <OwnerForm workspaceId={client.id} ownerId={client.owner_admin_id} gestores={gestores} />
            </Card>
          )}
        </>
      )}

      {tab === "fontes" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              status={lpStatus}
              title="Landing Pages"
              summary={`${client.pages.length} ${client.pages.length === 1 ? "página" : "páginas"}${client.last_event_at ? ` · último dado ${timeSince(client.last_event_at, now)}` : ""}`}
              href="#lps"
            />
            <Tile
              status={sheetsStatus}
              title="Google Sheets"
              summary={sources.length ? `${sources.length} ${sources.length === 1 ? "planilha conectada" : "planilhas conectadas"}` : "Formulários da Meta ou outras planilhas"}
              href="#sheets"
            />
            <Tile
              status={formsStatus}
              title="Formulários da Meta (API)"
              summary={formsActive.length ? `${formsActive.length} ${formsActive.length === 1 ? "formulário" : "formulários"} conectado(s)` : "Leads dos formulários nativos, direto"}
              href="#forms"
            />
          </div>

          <section id="lps" className="flex scroll-mt-24 flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold">Landing Pages</h2>
              <p className="text-sm text-zinc-600">Cada página tem seu código. Instale uma vez; os leads caem na planilha com campanha, anúncio e clique do anúncio.</p>
            </div>
            {client.pages.map((page) => {
              const last = lastEventOf(page.id);
              return (
                <Card
                  key={page.id}
                  title={page.name}
                  actions={
                    <span className="text-xs text-zinc-500">
                      {last ? `último dado ${timeSince(last, now)}` : "sem dados recentes"}
                    </span>
                  }
                >
                  <div className="flex flex-col gap-3 text-sm">
                    <p className="text-zinc-600">
                      Domínio liberado:{" "}
                      {page.domains.length ? (
                        <span className="font-mono text-xs text-zinc-900">{page.domains.join(", ")}</span>
                      ) : (
                        <span className="text-amber-700">qualquer domínio (libere o endereço da LP em Configurar)</span>
                      )}
                    </p>
                    <details className="rounded-lg border border-zinc-200">
                      <summary className="cursor-pointer px-3 py-2 font-medium">Instalar na LP (código e prompt)</summary>
                      <div className="flex flex-col gap-4 border-t border-zinc-100 p-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">Código para colar no &lt;head&gt; da LP</span>
                            <CopyButton text={snippet(origin, page)} label="Copiar código" />
                          </div>
                          <pre className="overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-100">{snippet(origin, page)}</pre>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">Prompt de instalação (para o Claude Code da LP)</span>
                            <CopyButton text={installPrompt(origin, page)} label="Copiar prompt" />
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
                            {installPrompt(origin, page)}
                          </pre>
                        </div>
                      </div>
                    </details>
                    <details className="rounded-lg border border-zinc-200">
                      <summary className="cursor-pointer px-3 py-2 font-medium">Configurar (nome, domínio, código no WhatsApp)</summary>
                      <div className="border-t border-zinc-100 p-3">
                        <PageSettings workspaceId={client.id} page={page} />
                      </div>
                    </details>
                  </div>
                </Card>
              );
            })}
            <Card title="Adicionar outra Landing Page">
              <AddPageForm workspaceId={client.id} />
            </Card>
          </section>

          <section id="sheets" className="scroll-mt-24">
            <Card title="Google Sheets (formulários da Meta e outras planilhas)">
              <SheetSources workspaceId={client.id} sources={sources} />
            </Card>
          </section>

          <section id="forms" className="scroll-mt-24">
            <Card title="Formulários da Meta: conexão direta pela API (avançado)">
              <LeadForms workspaceId={client.id} data={leadForms} serverReady={Boolean(serverSecret()) && Boolean(encryptionKey())} />
            </Card>
          </section>
        </>
      )}

      {tab === "conversoes" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Tile status={metaStatus} title="Meta Ads" summary="Lead, Agendado e Venda (com valor) voltam para a conta de anúncios." href="#meta" />
            <Tile status={googleStatus} title="Google Ads" summary="Importação de conversões off-line por arquivo agendado." href="#google" />
          </div>
          <section id="meta" className="scroll-mt-24">
            <Card title="Conversões para a Meta (API de Conversões)">
              <MetaSettings workspaceId={client.id} data={meta} pixels={pixels.map((p) => p.pixel_id)} serverReady={{ secret: Boolean(serverSecret()), key: Boolean(encryptionKey()) }} />
            </Card>
          </section>
          <section id="google" className="scroll-mt-24">
            <Card title="Conversões para o Google Ads">
              <GoogleAds workspaceId={client.id} data={googleAds} origin={origin} />
            </Card>
          </section>
        </>
      )}

      {tab === "acessos" && !team && (
        <>
          <Card title="Atendentes (planilha do cliente)">
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Link: <code className="font-mono">{`${origin}/w/${client.slug}`}</code>
              </p>
              <p className="text-zinc-600">
                Uma senha para a equipe que atende os leads: vê só a planilha deste cliente. A senha só aparece quando é gerada; gerar outra
                desliga a antiga na hora.
              </p>
              <ResetPassword origin={origin} id={client.id} name={client.name} slug={client.slug} />
            </div>
          </Card>
          {manages && (
            <Card title="Integrações pelos atendentes">
              <TeamAccess workspaceId={client.id} enabled={teamAccess === true} />
            </Card>
          )}
          {manages && (
            <Card title="Pessoas com acesso à configuração deste cliente">
              <Members workspaceId={client.id} client={client.name} origin={origin} members={members} />
            </Card>
          )}
          {role === "master" && (
            <Card title="Responsável (gestor)">
              <OwnerForm workspaceId={client.id} ownerId={client.owner_admin_id} gestores={gestores} />
            </Card>
          )}
        </>
      )}

      {tab === "privacidade" && (
        <Card title="Privacidade (LGPD)">
          <PrivacySettings workspaceId={client.id} data={privacy} policyUrl={`${origin}/privacidade/${client.slug}`} />
        </Card>
      )}

      {tab === "atividade" && (
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
                      <td className="px-2 py-1.5">{eventName(e)}</td>
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
      )}

      {role === "master" && tab === "visao" && (
        <Card title="Zona de perigo" className="border-red-200">
          <DeleteClient workspaceId={client.id} name={client.name} leads={client.leads_total} />
        </Card>
      )}
    </div>
  );
}
