"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appOrigin, requireAdmin, ADMIN_COOKIE, type ClientSummary } from "@/lib/admin";
import { clientIp } from "@/lib/collect";
import { sendTestConversion } from "@/lib/conversions";
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
  const result = await call<{ token: string } | null>("lh_admin_login", {
    p_login: login,
    p_password: String(formData.get("password") ?? ""),
  });
  // Returned so the form keeps the e-mail after a failed attempt.
  if (!result) return { error: "E-mail ou senha incorretos.", login };
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
  try {
    await call("lh_admin_set_meta", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_pixel_id: pixelId,
      p_access_token: String(formData.get("access_token") ?? "").trim(),
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

export async function sendMetaTest(workspaceId: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const h = await headers();
  const request = new Request("https://x", { headers: h });
  const result = await sendTestConversion(workspaceId, {
    ip: clientIp(request),
    userAgent: h.get("user-agent") ?? undefined,
    url: await appOrigin(),
  });
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {
    ok: result.ok,
    message: result.ok ? "Evento de teste enviado. Confira em Testar eventos no Gerenciador de Eventos." : `Falhou: ${result.response}`,
  };
}
