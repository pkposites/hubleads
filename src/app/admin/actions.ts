"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, ADMIN_COOKIE, type ClientSummary } from "@/lib/admin";
import { clientIp } from "@/lib/collect";
import { sendTestConversion } from "@/lib/conversions";
import { encryptSecret } from "@/lib/crypto";
import { encryptionKey, lockedMessage, loginClient } from "@/lib/server";
import { call, DbError } from "@/lib/db";
import { normalizeDomain } from "@/lib/domains";
import { slugify } from "@/lib/format";
import { SESSION_COOKIE } from "@/lib/session";

export type AdminFormState = { error?: string; ok?: string; login?: string } | undefined;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

function parseDomains(raw: FormDataEntryValue | null): string[] | "invalid" {
  const domains = String(raw ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(normalizeDomain);
  if (domains.some((d) => !d)) return "invalid";
  return [...new Set(domains as string[])];
}

export async function adminLogin(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const login = String(formData.get("login") ?? "");
  const result = await call<{ token?: string; locked?: boolean; retry_after?: number } | null>("lh_admin_login", {
    p_login: login,
    p_password: String(formData.get("password") ?? ""),
    p_client: await loginClient(),
  });
  // Returned so the form keeps the e-mail after a failed attempt.
  if (!result) return { error: "E-mail ou senha incorretos.", login };
  if (result.locked || !result.token) return { error: lockedMessage(result.retry_after ?? 900), login };
  (await cookies()).set(ADMIN_COOKIE, result.token, cookieOptions(60 * 60 * 24 * 7));
  redirect("/admin");
}

export async function adminLogout() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (token) await call("lh_admin_logout", { p_token: token }).catch(() => undefined);
  store.delete(ADMIN_COOKIE);
  redirect("/admin/entrar");
}

export type CreateClientState =
  | { error?: string; created?: { id: string; name: string; slug: string; password: string } }
  | undefined;

export async function createClient(_prev: CreateClientState, formData: FormData): Promise<CreateClientState> {
  const { token } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") || name));
  const domains = parseDomains(formData.get("domains"));
  if (!name || !slug) return { error: "Informe o nome do cliente." };
  if (domains === "invalid") return { error: "Domínio inválido. Use algo como clinica.com.br." };

  try {
    const result = await call<{ workspace: ClientSummary; password: string }>("lh_admin_create_workspace", {
      p_token: token,
      p_name: name,
      p_slug: slug,
      p_page_name: String(formData.get("page_name") ?? ""),
      p_domains: domains,
    });
    revalidatePath("/admin");
    return { created: { id: result.workspace.id, name, slug: result.workspace.slug, password: result.password } };
  } catch (error) {
    if (error instanceof DbError && error.code === "23505") return { error: `O endereço "${slug}" já está em uso.` };
    return { error: "Não foi possível criar o cliente." };
  }
}

export async function resetPassword(workspaceId: string): Promise<{ password?: string; error?: string }> {
  const { token } = await requireAdmin();
  try {
    const password = await call<string>("lh_admin_reset_password", { p_token: token, p_workspace_id: workspaceId });
    return { password };
  } catch {
    return { error: "Não foi possível gerar a senha." };
  }
}

/** Opens the client's sheet in this browser with an admin session. */
export async function openClientSheet(workspaceId: string) {
  const { token } = await requireAdmin();
  const session = await call<{ token: string; slug: string }>("lh_admin_open_workspace", {
    p_token: token,
    p_workspace_id: workspaceId,
  });
  (await cookies()).set(SESSION_COOKIE, session.token, cookieOptions(60 * 60 * 12));
  redirect(`/w/${session.slug}/atender`);
}

export async function updatePageSettings(
  workspaceId: string,
  pageId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const domains = parseDomains(formData.get("domains"));
  if (domains === "invalid") return { error: "Domínio inválido. Use algo como clinica.com.br ou *.clinica.com.br." };
  await call("lh_admin_update_page", {
    p_token: token,
    p_page_id: pageId,
    p_name: String(formData.get("name") ?? ""),
    p_domains: domains,
    p_whatsapp_code: formData.get("whatsapp_code") === "on",
  });
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return { ok: "Salvo." };
}

export async function addPage(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const domains = parseDomains(formData.get("domains"));
  if (domains === "invalid") return { error: "Domínio inválido." };
  await call("lh_admin_add_page", {
    p_token: token,
    p_workspace_id: workspaceId,
    p_name: String(formData.get("name") ?? ""),
    p_domains: domains,
  });
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return { ok: "Landing Page adicionada." };
}

/** Meta Conversions API settings. A blank token keeps the saved one. */
export async function saveMetaSettings(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const pixelId = String(formData.get("pixel_id") ?? "").trim();
  if (!/^\d{5,30}$/.test(pixelId)) return { error: "ID do pixel (conjunto de dados) inválido: use só os números." };
  // The token is encrypted here, before it reaches the database.
  const plainToken = String(formData.get("access_token") ?? "").trim();
  if (plainToken && !/^[A-Za-z0-9_-]{20,1000}$/.test(plainToken)) return { error: "Token de acesso inválido." };
  const key = encryptionKey();
  if (plainToken && !key) return { error: "O servidor ainda não tem a chave LH_ENCRYPTION_KEY; o token não foi salvo." };
  try {
    await call("lh_admin_set_meta", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_pixel_id: pixelId,
      p_access_token: plainToken && key ? encryptSecret(plainToken, key) : "",
      p_token_hint: plainToken.slice(-4),
      p_test_event_code: String(formData.get("test_event_code") ?? "").trim(),
      p_enabled: formData.get("enabled") === "on",
      p_send_schedule: formData.get("send_schedule") === "on",
      p_send_purchase: formData.get("send_purchase") === "on",
    });
  } catch (error) {
    if (error instanceof DbError && error.code === "22023") return { error: "Informe o token de acesso." };
    return { error: "Não foi possível salvar." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return { ok: "Salvo." };
}

export async function sendMetaTest(workspaceId: string, testCode: string): Promise<{ ok: boolean; message: string }> {
  const { token } = await requireAdmin();
  const code = testCode.trim();
  if (code && !/^[A-Za-z0-9_-]{2,40}$/.test(code)) return { ok: false, message: "Código de teste inválido." };
  // The send below uses the server secret, so check first that this admin may manage the client.
  try {
    await call("lh_admin_get_meta", { p_token: token, p_workspace_id: workspaceId });
  } catch {
    return { ok: false, message: "Cliente não encontrado." };
  }
  const h = await headers();
  const request = new Request("https://x", { headers: h });
  const result = await sendTestConversion(
    workspaceId,
    { ip: clientIp(request), userAgent: h.get("user-agent") ?? undefined },
    code,
  );
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {
    ok: result.ok,
    message: result.ok ? "Evento de teste enviado. Confira em Testar eventos no Gerenciador de Eventos." : `Falhou: ${result.response}`,
  };
}

export async function savePrivacySettings(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "E-mail inválido." };
  const months = Number(formData.get("retention_months") ?? 24);
  if (!Number.isInteger(months) || months < 1 || months > 120) return { error: "Prazo de guarda entre 1 e 120 meses." };
  try {
    await call("lh_admin_set_privacy", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_controller: String(formData.get("controller") ?? ""),
      p_document: String(formData.get("document") ?? ""),
      p_email: email,
      p_retention_months: months,
    });
  } catch {
    return { error: "Não foi possível salvar." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return { ok: "Salvo." };
}

// ---------------------------------------------------------------------------
// Gestores (master only; checked again in the database)
// ---------------------------------------------------------------------------

export type GestorState = { error?: string; created?: { login: string; password: string } } | undefined;

export async function createGestor(_prev: GestorState, formData: FormData): Promise<GestorState> {
  const { token } = await requireAdmin();
  const login = String(formData.get("login") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) return { error: "Informe o e-mail do gestor." };
  try {
    const result = await call<{ login: string; password: string }>("lh_admin_create_gestor", { p_token: token, p_login: login });
    revalidatePath("/admin/gestores");
    return { created: result };
  } catch (error) {
    if (error instanceof DbError && error.code === "23505") return { error: "Já existe um acesso com esse e-mail." };
    if (error instanceof DbError && error.code === "LH403") return { error: "Só o administrador master cria gestores." };
    return { error: "Não foi possível criar o gestor." };
  }
}

export async function resetGestorPassword(adminId: string): Promise<{ password?: string; error?: string }> {
  const { token } = await requireAdmin();
  try {
    const password = await call<string>("lh_admin_reset_admin_password", { p_token: token, p_admin_id: adminId });
    revalidatePath("/admin/gestores");
    return { password };
  } catch {
    return { error: "Não foi possível gerar a senha." };
  }
}

export async function deactivateGestor(adminId: string): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  try {
    await call("lh_admin_deactivate_gestor", { p_token: token, p_admin_id: adminId });
    revalidatePath("/admin/gestores");
    return {};
  } catch {
    return { error: "Não foi possível desativar." };
  }
}

export async function transferClient(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const target = String(formData.get("owner") ?? "");
  try {
    await call("lh_admin_transfer_workspace", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_admin_id: target === "" ? null : target,
    });
  } catch {
    return { error: "Não foi possível trocar o responsável." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  revalidatePath("/admin");
  return { ok: "Responsável atualizado." };
}
