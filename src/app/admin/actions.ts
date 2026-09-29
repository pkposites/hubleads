"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appOrigin, requireAdmin, ADMIN_COOKIE, type ClientSummary } from "@/lib/admin";
import { appsScript } from "@/lib/lead-sources";
import type { GoogleAdsSettings } from "@/lib/google-ads";
import { clientIp } from "@/lib/collect";
import { sendTestConversion } from "@/lib/conversions";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { explainGraphError, listForms, listPages } from "@/lib/meta-leads";
import { syncMetaForms } from "@/lib/meta-lead-sync";
import { mailReady, publicAppUrl, resetPasswordEmail, sendMail } from "@/lib/mail";
import { encryptionKey, lockedMessage, loginClient, serverSecret } from "@/lib/server";
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

/** New-lead notifications of all the admin's clients on this device. */
export async function adminPushSubscribe(subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  if (!subscription.endpoint || !/^https:\/\//.test(subscription.endpoint) || !subscription.keys?.p256dh || !subscription.keys.auth) {
    return { error: "Assinatura inválida." };
  }
  try {
    await call("lh_admin_push_subscribe", {
      p_token: token,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
    });
    return {};
  } catch {
    return { error: "Não foi possível ativar os avisos." };
  }
}

export async function adminPushUnsubscribe(endpoint: string) {
  const { token } = await requireAdmin();
  await call("lh_admin_push_unsubscribe", { p_token: token, p_endpoint: endpoint }).catch(() => undefined);
}

export async function adminLogout() {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (token) await call("lh_admin_logout", { p_token: token }).catch(() => undefined);
  store.delete(ADMIN_COOKIE);
  redirect("/admin/entrar");
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** New password typed twice; returns the error to show, if any. */
function checkNewPassword(formData: FormData): { password: string } | { error: string } {
  const password = String(formData.get("new_password") ?? "");
  if (password.length < 10) return { error: "A senha nova precisa ter pelo menos 10 caracteres." };
  if (password.length > 200) return { error: "A senha nova é longa demais." };
  if (password !== String(formData.get("confirm_password") ?? "")) return { error: "As duas senhas não são iguais." };
  return { password };
}

/** Minha conta: the logged-in admin changes their own password. */
export async function changeAdminPassword(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const checked = checkNewPassword(formData);
  if ("error" in checked) return checked;
  const result = await call<{ ok?: boolean; error?: string; retry_after?: number }>("lh_admin_change_password", {
    p_token: token,
    p_current: String(formData.get("current_password") ?? ""),
    p_new: checked.password,
  });
  if (result.error === "locked") return { error: lockedMessage(result.retry_after ?? 900) };
  if (!result.ok) return { error: "A senha atual está incorreta." };
  return { ok: "Senha alterada. Nos outros aparelhos, será preciso entrar de novo." };
}

/**
 * Esqueci minha senha: e-mails a one-time link. The answer is the same whether
 * or not the e-mail has access, and takes at least the same time, so the page
 * does not reveal who is registered.
 */
export async function requestAdminReset(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const login = String(formData.get("login") ?? "").trim().toLowerCase();
  if (!EMAIL.test(login)) return { error: "Informe um e-mail válido.", login };
  const secret = serverSecret();
  const base = publicAppUrl();
  if (!secret || !base || !mailReady()) {
    return { error: "A recuperação por e-mail ainda não está configurada. Fale com o administrador do Lead Hub.", login };
  }
  const started = Date.now();
  const reset = await call<{ token: string; login: string } | null>("lh_server_admin_reset_request", {
    p_secret: secret,
    p_login: login,
  });
  if (reset) await sendMail({ to: reset.login, ...resetPasswordEmail(`${base}/admin/redefinir?t=${reset.token}`) });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1500 - (Date.now() - started))));
  return {
    ok: "Se este e-mail tiver acesso ao painel, enviamos um link para criar uma senha nova. Ele vale por 30 minutos. Confira também a caixa de spam.",
    login,
  };
}

/** Sets the new password from the e-mailed link. */
export async function resetAdminPassword(resetToken: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const checked = checkNewPassword(formData);
  if ("error" in checked) return checked;
  const secret = serverSecret();
  if (!secret) return { error: "A recuperação de senha não está configurada no servidor." };
  const result = await call<{ login: string } | null>("lh_server_admin_reset_password", {
    p_secret: secret,
    p_token: resetToken,
    p_new: checked.password,
  });
  if (!result) return { error: "Este link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\"." };
  redirect("/admin/entrar?senha=nova");
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
  if (email && !EMAIL.test(email)) return { error: "E-mail inválido." };
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
  if (!EMAIL.test(login)) return { error: "Informe o e-mail do gestor." };
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

/** Master only: deletes the client and everything of it, after typing its name. */
export async function deleteClient(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const name = String(formData.get("confirm_name") ?? "");
  try {
    await call("lh_admin_delete_workspace", { p_token: token, p_workspace_id: workspaceId, p_confirm_name: name });
  } catch (error) {
    if (error instanceof DbError && error.code === "22023") return { error: "O nome digitado não é igual ao nome do cliente." };
    if (error instanceof DbError && error.code === "LH403") return { error: "Só o master pode apagar clientes." };
    return { error: "Não foi possível apagar o cliente." };
  }
  revalidatePath("/admin");
  redirect(`/admin?apagado=${encodeURIComponent(name.trim())}`);
}

// ---------------------------------------------------------------------------
// Meta native forms (Lead Ads)
// ---------------------------------------------------------------------------

/** Checks the token with Meta (lists its Pages), then saves it encrypted. */
export async function saveLeadToken(workspaceId: string, _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const { token } = await requireAdmin();
  const plain = String(formData.get("lead_token") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,1000}$/.test(plain)) return { error: "Token inválido: cole o token do usuário do sistema (começa com EAA)." };
  const key = encryptionKey();
  if (!key) return { error: "O servidor ainda não tem a chave LH_ENCRYPTION_KEY; o token não foi salvo." };
  let pages: { id: string; name: string }[];
  try {
    pages = await listPages(plain);
  } catch (error) {
    return { error: explainGraphError(error) };
  }
  try {
    await call("lh_admin_set_lead_token", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_access_token: encryptSecret(plain, key),
      p_token_hint: plain.slice(-4),
    });
  } catch {
    return { error: "Não foi possível salvar." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return pages.length
    ? { ok: `Token salvo. Páginas visíveis: ${pages.map((p) => p.name).join(", ")}.` }
    : { error: "Token salvo, mas ele não enxerga nenhuma Página: atribua a Página ao usuário do sistema no Gerenciador de Negócios." };
}

export async function removeLeadToken(workspaceId: string): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  try {
    await call("lh_admin_set_lead_token", { p_token: token, p_workspace_id: workspaceId, p_access_token: null, p_token_hint: null });
  } catch {
    return { error: "Não foi possível remover." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {};
}

export type MetaPageForms = { id: string; name: string; forms: { id: string; name: string; status: string; leads: number | null }[]; error?: string };

/** The client's Pages and their forms, read from Meta with the saved token. */
export async function loadLeadForms(workspaceId: string): Promise<{ pages?: MetaPageForms[]; error?: string }> {
  const { token } = await requireAdmin();
  const secret = serverSecret();
  const key = encryptionKey();
  if (!secret || !key) return { error: "Servidor sem LH_SERVER_SECRET ou LH_ENCRYPTION_KEY." };
  try {
    // Checks that this admin may manage the client before using the server secret.
    await call("lh_admin_get_lead_forms", { p_token: token, p_workspace_id: workspaceId });
  } catch {
    return { error: "Cliente não encontrado." };
  }
  const stored = await call<string | null>("lh_server_lead_token", { p_secret: secret, p_workspace_id: workspaceId });
  if (!stored) return { error: "Salve o token primeiro." };
  let plain: string;
  try {
    plain = decryptSecret(stored, key);
  } catch {
    return { error: "Não foi possível ler o token: salve-o de novo." };
  }
  try {
    const pages = await listPages(plain);
    const result: MetaPageForms[] = [];
    for (const page of pages.slice(0, 20)) {
      try {
        result.push({ ...page, forms: await listForms(plain, page.id) });
      } catch (error) {
        result.push({ ...page, forms: [], error: explainGraphError(error) });
      }
    }
    return { pages: result };
  } catch (error) {
    return { error: explainGraphError(error) };
  }
}

/** Connects a form. importDays: how many past days to bring now (0 = only new leads). */
export async function connectLeadForm(
  workspaceId: string,
  form: { page_id: string; page_name: string; form_id: string; form_name: string },
  importDays: number,
): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  const days = [0, 1, 7, 30, 90].includes(importDays) ? importDays : 0;
  const since = Math.floor(Date.now() / 1000) - days * 86_400 + (days === 90 ? 3600 : 0);
  try {
    await call("lh_admin_set_lead_form", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_page_id: form.page_id,
      p_page_name: form.page_name,
      p_form_id: form.form_id,
      p_form_name: form.form_name,
      p_enabled: true,
      p_since: since,
    });
  } catch {
    return { error: "Não foi possível conectar o formulário." };
  }
  // First import right away instead of waiting for the next minute.
  after(() => syncMetaForms(Date.now() + 20_000).then(() => undefined));
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {};
}

export async function setLeadFormEnabled(
  workspaceId: string,
  form: { page_id: string; page_name: string | null; form_id: string; form_name: string | null },
  enabled: boolean,
): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  try {
    await call("lh_admin_set_lead_form", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_page_id: form.page_id,
      p_page_name: form.page_name ?? "",
      p_form_id: form.form_id,
      p_form_name: form.form_name ?? "",
      p_enabled: enabled,
      p_since: Math.floor(Date.now() / 1000),
    });
  } catch {
    return { error: "Não foi possível alterar." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {};
}

// ---------------------------------------------------------------------------
// Lead sources: Google Sheets (Apps Script)
// ---------------------------------------------------------------------------

/** Creates a Sheets source and returns the Apps Script with its key (shown once). */
export async function createSheetSource(workspaceId: string, name: string): Promise<{ script?: string; error?: string }> {
  const { token } = await requireAdmin();
  try {
    const created = await call<{ id: string; key: string }>("lh_admin_create_source", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_kind: "sheets",
      p_name: name.trim().slice(0, 120) || "Google Sheets",
    });
    revalidatePath(`/admin/clientes/${workspaceId}`);
    return { script: appsScript(`${await appOrigin()}/api/sources/sheets`, created.key) };
  } catch {
    return { error: "Não foi possível criar a conexão." };
  }
}

/** New key (the old script stops working) and the script to paste again. */
export async function rotateSheetSourceKey(workspaceId: string, sourceId: string): Promise<{ script?: string; error?: string }> {
  const { token } = await requireAdmin();
  try {
    const key = await call<string>("lh_admin_rotate_source_key", { p_token: token, p_workspace_id: workspaceId, p_source_id: sourceId });
    revalidatePath(`/admin/clientes/${workspaceId}`);
    return { script: appsScript(`${await appOrigin()}/api/sources/sheets`, key) };
  } catch {
    return { error: "Não foi possível gerar a nova chave." };
  }
}

export async function updateSheetSource(workspaceId: string, sourceId: string, change: { enabled?: boolean; remove?: boolean }): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  try {
    await call("lh_admin_update_source", {
      p_token: token,
      p_workspace_id: workspaceId,
      p_source_id: sourceId,
      p_enabled: change.enabled ?? null,
      p_delete: change.remove ?? false,
    });
  } catch {
    return { error: "Não foi possível alterar." };
  }
  revalidatePath(`/admin/clientes/${workspaceId}`);
  return {};
}

/** Turns the Google Ads file on, or gives it a new password (shown once). */
export async function googleAdsCredentials(workspaceId: string): Promise<{ settings?: GoogleAdsSettings; url?: string; error?: string }> {
  const { token } = await requireAdmin();
  try {
    const settings = await call<GoogleAdsSettings>("lh_admin_google_ads_credentials", { p_token: token, p_workspace_id: workspaceId });
    revalidatePath(`/admin/clientes/${workspaceId}`);
    return { settings, url: `${await appOrigin()}/api/google-ads/${settings.feed_id}` };
  } catch {
    return { error: "Não foi possível gerar o acesso." };
  }
}

export async function updateGoogleAds(
  workspaceId: string,
  change: Partial<Pick<GoogleAdsSettings, "enabled" | "lead_name" | "schedule_name" | "purchase_name" | "send_lead" | "send_schedule" | "send_purchase">> & {
    remove?: boolean;
  },
): Promise<{ error?: string }> {
  const { token } = await requireAdmin();
  const { remove, ...settings } = change;
  for (const key of ["lead_name", "schedule_name", "purchase_name"] as const) {
    if (key in settings) {
      const name = String(settings[key] ?? "").trim().slice(0, 100);
      if (!name) return { error: "Dê um nome para cada conversão." };
      settings[key] = name;
    }
  }
  try {
    await call("lh_admin_update_google_ads", { p_token: token, p_workspace_id: workspaceId, p_settings: settings, p_delete: Boolean(remove) });
    revalidatePath(`/admin/clientes/${workspaceId}`);
    return {};
  } catch {
    return { error: "Não foi possível salvar." };
  }
}
