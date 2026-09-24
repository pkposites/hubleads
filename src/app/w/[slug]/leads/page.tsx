import Link from "next/link";
import { Badge, buttonClass, EmptyState, inputClass } from "@/components/ui";
import { channelLabel, CHANNELS } from "@/lib/attribution";
import { formatDateTime, formatPhone, timeSince } from "@/lib/format";
import { whatsappDigits } from "@/lib/normalize";
import { canEditLeads, type Lead, type Project, type Stage } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";
import { StageSelect } from "./stage-select";

const PAGE_SIZE = 50;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LeadsPage({ params, searchParams }: PageProps<"/w/[slug]/leads">) {
  const { slug } = await params;
  const sp = await searchParams;
  const projectFilter = first(sp.project);
  const stageFilter = first(sp.stage);
  const channelFilter = first(sp.channel);
  // Characters that would change the meaning of a PostgREST or() filter.
  const q = first(sp.q).replace(/[,()*%"\\]/g, " ").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(first(sp.page) || "1", 10) || 1);

  const { supabase, workspace, role } = await getWorkspaceContext(slug);

  const [{ data: projectRows }, { data: stageRows }] = await Promise.all([
    supabase.from("projects").select("id, name, status").eq("workspace_id", workspace.id).order("name"),
    supabase.from("pipeline_stages").select("*").eq("workspace_id", workspace.id).order("position"),
  ]);
  const projects = (projectRows ?? []) as Pick<Project, "id" | "name" | "status">[];
  const stages = (stageRows ?? []) as Stage[];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const stagesByProject = new Map<string, Stage[]>();
  for (const stage of stages) {
    stagesByProject.set(stage.project_id, [...(stagesByProject.get(stage.project_id) ?? []), stage]);
  }
  const stageKeys = [...new Map(stages.map((s) => [s.key, s.name])).entries()];

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (projectFilter) query = query.eq("project_id", projectFilter);
  if (stageFilter) query = query.in("current_stage_id", stages.filter((s) => s.key === stageFilter).map((s) => s.id));
  if (channelFilter) query = query.eq("source_channel", channelFilter);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const clauses = [`name.ilike."*${q}*"`, `email_norm.ilike."*${q.toLowerCase()}*"`];
    if (digits.length >= 4) clauses.push(`phone_norm.like."*${digits}*"`);
    query = query.or(clauses.join(","));
  }
  const { data: leadRows, count } = await query;
  const leads = (leadRows ?? []) as Lead[];
  const total = count ?? 0;
  const filtered = Boolean(projectFilter || stageFilter || channelFilter || q);

  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ project: projectFilter, stage: stageFilter, channel: channelFilter, q })) {
      if (v) next.set(k, v);
    }
    next.set("page", String(n));
    return `/w/${slug}/leads?${next}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Leads</h1>
        <span className="text-sm text-zinc-600">{total} no total</span>
      </div>

      <form className="grid gap-2 sm:grid-cols-[1fr_repeat(3,minmax(0,180px))_auto]" method="get">
        <input name="q" defaultValue={q} placeholder="Buscar nome, telefone ou e-mail" className={inputClass} />
        <select name="project" defaultValue={projectFilter} className={inputClass} aria-label="Projeto">
          <option value="">Todos os projetos</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="stage" defaultValue={stageFilter} className={inputClass} aria-label="Estágio">
          <option value="">Todos os estágios</option>
          {stageKeys.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <select name="channel" defaultValue={channelFilter} className={inputClass} aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(CHANNELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>

      {leads.length === 0 ? (
        filtered ? (
          <EmptyState title="Nenhum lead com esses filtros" />
        ) : (
          <EmptyState title="Nenhum lead chegou ainda">
            Conecte uma Landing Page ou envie um lead de teste na página do{" "}
            <Link className="underline" href={`/w/${slug}/projects`}>
              projeto
            </Link>
            .
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Projeto</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 font-medium">Campanha / anúncio</th>
                <th className="px-3 py-2 font-medium">Entrada</th>
                <th className="px-3 py-2 font-medium">Estágio</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {leads.map((lead) => {
                const touch = lead.first_touch ?? {};
                const wa = whatsappDigits(lead.phone_norm);
                return (
                  <tr key={lead.id} className="align-top">
                    <td className="px-3 py-2">
                      <Link href={`/w/${slug}/leads/${lead.id}`} className="font-medium hover:underline">
                        {lead.name ?? "Sem nome"}
                      </Link>
                      <div className="text-xs text-zinc-600">{formatPhone(lead.phone_norm, lead.email)}</div>
                      {lead.needs_review && <Badge tone="warn">Revisar duplicidade</Badge>}
                    </td>
                    <td className="px-3 py-2">{projectName.get(lead.project_id)}</td>
                    <td className="px-3 py-2">{channelLabel(lead.source_channel)}</td>
                    <td className="px-3 py-2 text-xs">
                      <div>{touch.campaign_name ?? touch.utm_campaign ?? "—"}</div>
                      {(touch.ad_name || touch.ad_id || touch.utm_content) && (
                        <div className="text-zinc-500">
                          {touch.ad_name ?? touch.utm_content}
                          {touch.ad_id && <span className="font-mono"> #{touch.ad_id}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{formatDateTime(lead.created_at)}</div>
                      <div className="text-zinc-500">{timeSince(lead.created_at)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <StageSelect
                        slug={slug}
                        leadId={lead.id}
                        currentStageId={lead.current_stage_id}
                        stages={stagesByProject.get(lead.project_id) ?? []}
                        disabled={!canEditLeads(role)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {wa && (
                        <a
                          href={`https://wa.me/${wa}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-emerald-700 hover:underline"
                        >
                          WhatsApp
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-end gap-3 text-sm">
          {page > 1 && <Link href={pageHref(page - 1)} className="hover:underline">← Anterior</Link>}
          <span className="text-zinc-600">
            Página {page} de {Math.ceil(total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < total && <Link href={pageHref(page + 1)} className="hover:underline">Próxima →</Link>}
        </nav>
      )}
    </div>
  );
}
