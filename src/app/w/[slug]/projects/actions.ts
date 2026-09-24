"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { slugify } from "@/lib/format";
import { generateSecretKey, normalizeDomain } from "@/lib/ingest/keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManage, type ActionState } from "@/lib/types";
import { getWorkspaceContext } from "@/lib/workspace";

// Every action re-resolves the workspace from the slug and relies on RLS for
// writes; only the test-lead action uses the service role, after an explicit
// role check.

async function managerContext(slug: string) {
  const ctx = await getWorkspaceContext(slug);
  if (!canManage(ctx.role)) throw new Error("forbidden");
  return ctx;
}

export async function createProject(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, workspace, role } = await getWorkspaceContext(slug);
  if (!canManage(role)) return { error: "Apenas admins e gestores criam projetos." };

  const name = String(formData.get("name") ?? "").trim();
  const projectSlug = slugify(String(formData.get("slug") || name));
  if (!name || !projectSlug) return { error: "Informe o nome do projeto." };

  const { data, error } = await supabase
    .from("projects")
    .insert({ workspace_id: workspace.id, name, slug: projectSlug })
    .select("id")
    .single();
  if (error) {
    return { error: error.code === "23505" ? "Já existe um projeto com esse endereço." : "Não foi possível criar o projeto." };
  }
  redirect(`/w/${slug}/projects/${data.id}`);
}

export async function createLandingPage(
  slug: string,
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, workspace } = await managerContext(slug);
  const name = String(formData.get("name") ?? "").trim();
  const rawDomains = String(formData.get("domains") ?? "").split(/[\s,]+/).filter(Boolean);
  const domains = rawDomains.map(normalizeDomain);
  if (!name) return { error: "Informe um nome." };
  if (!domains.length || domains.some((d) => !d)) {
    return { error: "Informe domínios válidos, como cliente.com.br ou *.cliente.com.br." };
  }

  const { error } = await supabase
    .from("landing_pages")
    .insert({ workspace_id: workspace.id, project_id: projectId, name, domains: [...new Set(domains)] });
  if (error) return { error: "Não foi possível salvar a Landing Page." };
  revalidatePath(`/w/${slug}/projects/${projectId}`);
  return { ok: "Landing Page cadastrada." };
}

export async function createForm(
  slug: string,
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, workspace } = await managerContext(slug);
  const name = String(formData.get("name") ?? "").trim();
  const key = `frm_${slugify(String(formData.get("key") || name)).replace(/-/g, "_")}`.slice(0, 64);
  if (!name || key === "frm_") return { error: "Informe o nome do formulário." };

  const { error } = await supabase.from("forms").insert({ workspace_id: workspace.id, project_id: projectId, name, key });
  if (error) {
    return { error: error.code === "23505" ? `O identificador ${key} já existe neste projeto.` : "Não foi possível criar o formulário." };
  }
  revalidatePath(`/w/${slug}/projects/${projectId}`);
  return { ok: `Formulário ${key} criado.` };
}

export async function createApiKey(
  slug: string,
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, workspace, userId } = await managerContext(slug);
  const name = String(formData.get("name") ?? "").trim() || "Chave de integração";
  const { key, hash, prefix } = generateSecretKey();

  const { error } = await supabase.from("project_api_keys").insert({
    workspace_id: workspace.id,
    project_id: projectId,
    name,
    key_prefix: prefix,
    key_hash: hash,
    created_by: userId,
  });
  if (error) return { error: "Não foi possível criar a chave." };
  revalidatePath(`/w/${slug}/projects/${projectId}`);
  return { ok: "Chave criada. Copie agora: ela não será exibida novamente.", secret: key };
}

export async function revokeApiKey(slug: string, projectId: string, keyId: string) {
  const { supabase } = await managerContext(slug);
  await supabase
    .from("project_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("project_id", projectId);
  revalidatePath(`/w/${slug}/projects/${projectId}`);
}

/** §13.4: lets an admin check the pipeline end to end without a landing page. */
export async function sendTestLead(slug: string, projectId: string): Promise<ActionState> {
  const { supabase, workspace } = await managerContext(slug);

  // Proves the project belongs to this workspace under the user's own RLS
  // before the service role is used.
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!project) return { error: "Projeto não encontrado." };

  const suffix = String(randomInt(0, 10_000)).padStart(4, "0");
  const now = new Date().toISOString();
  const touch = {
    utm_source: "leadhub",
    utm_medium: "test",
    utm_campaign: "lead_de_teste",
    occurred_at: now,
    channel: "referral",
  };
  const { error } = await createAdminClient().rpc("ingest_lead_conversion", {
    p: {
      project_id: projectId,
      lead: {
        name: `Lead de teste ${suffix}`,
        phone: `(11) 90000-${suffix}`,
        phone_norm: `+551190000${suffix}`,
        email: null,
        email_norm: null,
      },
      answers: { origem: "Botão de lead de teste" },
      touch,
      first_touch: touch,
      tracking: { test: true },
      consent: { privacy_policy: true, captured_at: now },
    },
  });
  if (error) return { error: "Falha ao criar o lead de teste." };
  revalidatePath(`/w/${slug}/leads`);
  return { ok: `Lead de teste ${suffix} criado. Veja em Leads.` };
}
