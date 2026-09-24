import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui";
import { channelLabel } from "@/lib/attribution";
import { formatDateTime, formatMoney, formatPhone } from "@/lib/format";
import { whatsappDigits } from "@/lib/normalize";
import { canEditLeads, type Conversion, type Lead, type Stage, type StageHistory, type Touch } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";
import { StageSelect } from "../stage-select";

const TOUCH_FIELDS: [keyof Touch, string][] = [
  ["utm_source", "utm_source"],
  ["utm_medium", "utm_medium"],
  ["utm_campaign", "utm_campaign"],
  ["utm_content", "utm_content"],
  ["utm_term", "utm_term"],
  ["campaign_name", "Campanha"],
  ["campaign_id", "ID da campanha"],
  ["adset_name", "Conjunto"],
  ["adset_id", "ID do conjunto"],
  ["ad_name", "Anúncio"],
  ["ad_id", "ID do anúncio"],
  ["gclid", "gclid"],
  ["gbraid", "gbraid"],
  ["wbraid", "wbraid"],
  ["fbclid", "fbclid"],
  ["fbc", "fbc"],
  ["fbp", "fbp"],
  ["ttclid", "ttclid"],
  ["msclkid", "msclkid"],
  ["landing_page_url", "Página"],
  ["referrer", "Referrer"],
];

function TouchBlock({ title, touch }: { title: string; touch: Touch }) {
  const rows = TOUCH_FIELDS.filter(([key]) => touch[key]);
  return (
    <Card title={title}>
      <p className="mb-2 text-sm">
        <span className="font-medium">{channelLabel(touch.channel)}</span>
        {touch.occurred_at && <span className="text-zinc-500"> · {formatDateTime(touch.occurred_at)}</span>}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">Sem UTMs ou identificadores de clique.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="break-all font-mono">{touch[key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export default async function LeadPage({ params }: PageProps<"/w/[slug]/leads/[id]">) {
  const { slug, id } = await params;
  const { supabase, workspace, role } = await getWorkspaceContext(slug);

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle<Lead>();
  if (!lead) notFound();

  const [stagesRes, conversionsRes, historyRes, projectRes] = await Promise.all([
    supabase.from("pipeline_stages").select("*").eq("project_id", lead.project_id).order("position"),
    supabase
      .from("lead_conversions")
      .select("id, form_id, source_channel, answers, tracking, consent, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false }),
    supabase.from("lead_stage_history").select("*").eq("lead_id", lead.id).order("created_at", { ascending: false }),
    supabase.from("projects").select("name").eq("id", lead.project_id).single<{ name: string }>(),
  ]);
  const stages = (stagesRes.data ?? []) as Stage[];
  const conversions = (conversionsRes.data ?? []) as Conversion[];
  const history = (historyRes.data ?? []) as StageHistory[];
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const authorIds = [...new Set(history.map((h) => h.changed_by).filter((v): v is string => Boolean(v)))];
  const { data: authors } = authorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", authorIds)
    : { data: [] };
  const authorName = new Map((authors ?? []).map((a: { id: string; full_name: string | null }) => [a.id, a.full_name]));

  const timeline: { at: string; node: ReactNode }[] = [
    ...conversions.map((c) => ({
      at: c.created_at,
      node: (
        <>
          <span className="font-medium">Conversão recebida</span> · {channelLabel(c.source_channel)}
        </>
      ),
    })),
    ...history.map((h) => ({
      at: h.created_at,
      node: (
        <>
          <span className="font-medium">
            {h.from_stage_id ? `${stageName.get(h.from_stage_id) ?? "?"} → ` : "Entrou em "}
            {h.to_stage_id ? stageName.get(h.to_stage_id) ?? "?" : "?"}
          </span>
          {h.changed_by && <span className="text-zinc-500"> · por {authorName.get(h.changed_by) ?? "membro"}</span>}
          {h.metadata.lost_reason && <span className="text-zinc-600"> · motivo: {h.metadata.lost_reason}</span>}
          {h.metadata.sale_value !== undefined && (
            <span className="text-zinc-600"> · {formatMoney(h.metadata.sale_value, lead.currency)}</span>
          )}
        </>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const wa = whatsappDigits(lead.phone_norm);
  const latestAnswers = conversions[0]?.answers ?? {};

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/w/${slug}/leads`} className="text-sm text-zinc-600 hover:underline">
        ← Leads
      </Link>

      <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{lead.name ?? "Sem nome"}</h1>
          <p className="text-sm text-zinc-700">
            {formatPhone(lead.phone_norm, lead.phone)} {lead.email_norm && <>· {lead.email_norm}</>}
          </p>
          <p className="text-xs text-zinc-500">
            {projectRes.data?.name} · entrou em {formatDateTime(lead.created_at)}
          </p>
          {lead.needs_review && (
            <Badge tone="warn">Telefone e e-mail conflitam com outro lead: revisar duplicidade</Badge>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {wa && (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Chamar no WhatsApp
            </a>
          )}
          <StageSelect
            slug={slug}
            leadId={lead.id}
            currentStageId={lead.current_stage_id}
            stages={stages}
            disabled={!canEditLeads(role)}
          />
          {lead.sale_value && <span className="text-sm">Venda: {formatMoney(lead.sale_value, lead.currency)}</span>}
          {lead.lost_reason && <span className="text-sm text-zinc-600">Motivo da perda: {lead.lost_reason}</span>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Respostas">
          {Object.keys(latestAnswers).length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma resposta registrada.</p>
          ) : (
            <dl className="flex flex-col gap-2 text-sm">
              {Object.entries(latestAnswers).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-zinc-500">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        <TouchBlock title="First touch" touch={lead.first_touch ?? {}} />
        <TouchBlock title="Last touch" touch={lead.last_touch ?? {}} />
      </div>

      <Card title="Linha do tempo">
        <ol className="flex flex-col gap-2 text-sm">
          {timeline.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-28 shrink-0 text-xs text-zinc-500">{formatDateTime(item.at)}</span>
              <span>{item.node}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
