import { notFound } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { canManage, type ApiKey, type Form, type LandingPage, type Project, type Stage } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";
import { revokeApiKey } from "../actions";
import { ApiKeyForm, FormForm, LandingPageForm, TestLeadButton } from "./project-forms";

const KIND_LABEL = { open: null, won: "Venda", lost: "Perda" } as const;

export default async function ProjectPage({ params }: PageProps<"/w/[slug]/projects/[projectId]">) {
  const { slug, projectId } = await params;
  const { supabase, workspace, role } = await getWorkspaceContext(slug);

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name, slug, status, created_at")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .maybeSingle<Project>();
  if (!project) notFound();

  const manager = canManage(role);
  const [stages, pages, forms, keys] = await Promise.all([
    supabase.from("pipeline_stages").select("*").eq("project_id", projectId).order("position"),
    supabase.from("landing_pages").select("*").eq("project_id", projectId).order("created_at"),
    supabase.from("forms").select("*").eq("project_id", projectId).order("created_at"),
    manager
      ? supabase
          .from("project_api_keys")
          .select("id, project_id, name, key_prefix, created_at, last_used_at, revoked_at")
          .eq("project_id", projectId)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const stageList = (stages.data ?? []) as Stage[];
  const pageList = (pages.data ?? []) as LandingPage[];
  const formList = (forms.data ?? []) as Form[];
  const keyList = (keys.data ?? []) as ApiKey[];
  const apiBase = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{project.name}</h1>
        {manager && <TestLeadButton slug={slug} projectId={projectId} />}
      </div>

      <Card title="Pipeline">
        <ol className="flex flex-wrap gap-2 text-sm">
          {stageList.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 rounded border border-zinc-200 px-2 py-1">
              <span className="text-zinc-400">{s.position}.</span> {s.name}
              {KIND_LABEL[s.kind] && <Badge tone={s.kind === "won" ? "good" : "bad"}>{KIND_LABEL[s.kind]}</Badge>}
              {s.event_type && <code className="text-xs text-zinc-500">{s.event_type}</code>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Landing Pages">
          <div className="flex flex-col gap-4">
            {pageList.length === 0 && <p className="text-sm text-zinc-600">Nenhuma Landing Page conectada.</p>}
            {pageList.map((lp) => (
              <div key={lp.id} className="flex flex-col gap-2 border-b border-zinc-100 pb-4 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{lp.name}</span>
                  <span className="text-xs text-zinc-500">{lp.domains.join(", ")}</span>
                </div>
                <p className="text-xs text-zinc-600">
                  Chave pública: <code className="font-mono">{lp.public_key}</code>
                </p>
                <pre className="overflow-x-auto rounded bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
{`fetch("${apiBase}/api/v1/leads", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Project-Key": "${lp.public_key}",
    "Idempotency-Key": crypto.randomUUID()
  },
  body: JSON.stringify({
    form_id: "${formList[0]?.key ?? "frm_seu_formulario"}",
    lead: { name, phone, email },
    answers: { /* respostas do formulário */ },
    tracking: { /* UTMs e click ids da URL */ },
    consent: { privacy_policy: true }
  })
});`}
                </pre>
              </div>
            ))}
            {manager && <LandingPageForm slug={slug} projectId={projectId} />}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Formulários">
            <div className="flex flex-col gap-4">
              {formList.length === 0 ? (
                <p className="text-sm text-zinc-600">Nenhum formulário ainda.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {formList.map((f) => (
                    <li key={f.id} className="flex justify-between">
                      <span>{f.name}</span>
                      <code className="font-mono text-xs text-zinc-600">{f.key}</code>
                    </li>
                  ))}
                </ul>
              )}
              {manager && <FormForm slug={slug} projectId={projectId} />}
            </div>
          </Card>

          {manager && (
            <Card title="Chaves secretas (server to server)">
              <div className="flex flex-col gap-4">
                <p className="text-xs text-zinc-600">
                  Use em <code>Authorization: Bearer sk_live_…</code> com <code>Idempotency-Key</code>. Nunca exponha no navegador.
                </p>
                {keyList.length > 0 && (
                  <ul className="flex flex-col gap-2 text-sm">
                    {keyList.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-2">
                        <span>
                          {k.name} <code className="font-mono text-xs text-zinc-500">{k.key_prefix}…</code>
                          <span className="block text-xs text-zinc-500">
                            Último uso: {formatDateTime(k.last_used_at)}
                          </span>
                        </span>
                        {k.revoked_at ? (
                          <Badge tone="bad">Revogada</Badge>
                        ) : (
                          <form action={revokeApiKey.bind(null, slug, projectId, k.id)}>
                            <Button variant="danger">Revogar</Button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <ApiKeyForm slug={slug} projectId={projectId} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
