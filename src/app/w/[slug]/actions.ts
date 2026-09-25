"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { sendLeadConversions } from "@/lib/conversions";
import { call, DbError } from "@/lib/db";
import { fromLocalInput } from "@/lib/format";
import type { LpEvent } from "@/lib/lp-events";
import { isStatus, parseMoney, type HistoryEntry, type Lead, type Status, type Template } from "@/lib/leads";
import { normalizePhone } from "@/lib/normalize";
import { loginClient, lockedMessage } from "@/lib/server";
import { requireWorkspace, SESSION_COOKIE } from "@/lib/session";

export type FormState = { error?: string; ok?: string; slug?: string } | undefined;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!slug || !password) return { error: "Informe a empresa e a senha." };

  const result = await call<{ token?: string; slug?: string; locked?: boolean; retry_after?: number } | null>("lh_login", {
    p_slug: slug,
    p_password: password,
    p_client: await loginClient(),
  });
  // Returned so the form keeps the company after a failed attempt.
  if (!result) return { error: "Empresa ou senha incorretos.", slug };
  if (result.locked || !result.token) return { error: lockedMessage(result.retry_after ?? 900), slug };

  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(`/w/${result.slug}/atender`);
}

export async function logout(slug: string) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await call("lh_logout", { p_token: token }).catch(() => undefined);
  store.delete(SESSION_COOKIE);
  redirect(`/w/${slug}/entrar`);
}

export type EditableField = "name" | "phone" | "status" | "notes" | "sale_value" | "next_contact_at";

/**
 * Booked or sold leads may owe an event to Meta (sent after the response).
 * No revalidation here: the cell already shows the saved value, and the
 * client refreshes the rest in the background so the tap feels instant.
 */
function afterSave(lead: Lead) {
  if (lead.status === "agendado" || lead.status === "venda") after(() => sendLeadConversions(lead.id));
}

/** Saves one cell of the sheet. Returns the stored value or an error. */
export async function updateLeadField(
  slug: string,
  leadId: string,
  field: EditableField,
  raw: string,
): Promise<{ value?: unknown; error?: string }> {
  const { token } = await requireWorkspace(slug);
  let value: unknown = raw.trim();

  switch (field) {
    case "phone":
      if (value) {
        const normalized = normalizePhone(String(value));
        if (!normalized) return { error: "Telefone inválido. Use DDD + número." };
        value = normalized;
      }
      break;
    case "status":
      if (!isStatus(value)) return { error: "Status inválido." };
      break;
    case "sale_value": {
      const money = parseMoney(String(value));
      if (money === "invalid") return { error: "Valor inválido." };
      value = money ?? "";
      break;
    }
    case "next_contact_at":
      if (value) {
        const iso = fromLocalInput(String(value));
        if (!iso) return { error: "Data inválida." };
        value = iso;
      }
      break;
    case "name":
    case "notes":
      break;
    default:
      return { error: "Campo não editável." };
  }

  try {
    const lead = await call<Lead>("lh_update_lead", { p_token: token, p_lead_id: leadId, p_patch: { [field]: value } });
    afterSave(lead);
    return { value: lead[field] };
  } catch (error) {
    if (error instanceof DbError && error.code === "LH404") return { error: "Lead não encontrado." };
    if (error instanceof DbError && error.code === "22023") return { error: "Informe o motivo da perda." };
    return { error: "Não foi possível salvar." };
  }
}

/** Status change; "perdido" needs a reason. */
export async function setLeadStatus(
  slug: string,
  leadId: string,
  status: Status,
  lostReason?: string,
): Promise<{ lead?: Lead; error?: string }> {
  const { token } = await requireWorkspace(slug);
  if (!isStatus(status)) return { error: "Status inválido." };
  const reason = lostReason?.trim().slice(0, 200) ?? "";
  if (status === "perdido" && !reason) return { error: "Informe o motivo da perda." };
  try {
    const lead = await call<Lead>("lh_update_lead", {
      p_token: token,
      p_lead_id: leadId,
      p_patch: status === "perdido" ? { status, lost_reason: reason } : { status },
    });
    afterSave(lead);
    return { lead };
  } catch (error) {
    if (error instanceof DbError && error.code === "LH404") return { error: "Lead não encontrado." };
    return { error: "Não foi possível salvar." };
  }
}

/** A WhatsApp message was opened for the lead (first contact, "novo" -> "em atendimento"). */
export async function logContact(slug: string, leadId: string, template: string): Promise<{ lead?: Lead; error?: string }> {
  const { token } = await requireWorkspace(slug);
  try {
    const lead = await call<Lead>("lh_log_contact", { p_token: token, p_lead_id: leadId, p_template: template.slice(0, 60) });
    return { lead };
  } catch {
    return { error: "Não foi possível registrar o contato." };
  }
}

export async function leadHistory(
  slug: string,
  leadId: string,
): Promise<{ history?: HistoryEntry[]; lpEvents?: LpEvent[]; error?: string }> {
  const { token } = await requireWorkspace(slug);
  try {
    const detail = await call<{ history: HistoryEntry[]; lp_events: LpEvent[] }>("lh_lead_detail", { p_token: token, p_lead_id: leadId });
    return { history: detail.history, lpEvents: detail.lp_events };
  } catch {
    return { error: "Não foi possível carregar o histórico." };
  }
}

export async function saveTemplate(slug: string, id: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const { token, workspace } = await requireWorkspace(slug);
  if (workspace.role !== "admin") return { error: "Só o administrador altera as mensagens." };
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const position = Number(formData.get("position") ?? 99);
  if (!name || name.length > 60) return { error: "Dê um nome curto (até 60 caracteres)." };
  if (!body || body.length > 1000) return { error: "Escreva a mensagem (até 1000 caracteres)." };
  try {
    await call<Template>("lh_save_template", {
      p_token: token,
      p_id: id,
      p_name: name,
      p_body: body,
      p_position: Number.isFinite(position) ? Math.trunc(position) : 99,
    });
  } catch {
    return { error: "Não foi possível salvar a mensagem." };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: id ? "Mensagem salva." : "Mensagem criada." };
}

export async function deleteTemplate(slug: string, id: string): Promise<{ error?: string }> {
  const { token, workspace } = await requireWorkspace(slug);
  if (workspace.role !== "admin") return { error: "Só o administrador altera as mensagens." };
  try {
    await call("lh_delete_template", { p_token: token, p_id: id });
  } catch {
    return { error: "Não foi possível excluir." };
  }
  revalidatePath(`/w/${slug}`, "layout");
  return {};
}

export async function pushSubscribe(
  slug: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<{ error?: string }> {
  const { token } = await requireWorkspace(slug);
  if (!/^https:\/\//.test(subscription.endpoint)) return { error: "Assinatura inválida." };
  try {
    await call("lh_push_subscribe", {
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

export async function pushUnsubscribe(slug: string, endpoint: string) {
  const { token } = await requireWorkspace(slug);
  await call("lh_push_unsubscribe", { p_token: token, p_endpoint: endpoint }).catch(() => undefined);
}

/** Admin sessions only (checked again in the database). */
export async function deleteLeads(slug: string, leadIds: string[]): Promise<{ deleted?: number; error?: string }> {
  const { token, workspace } = await requireWorkspace(slug);
  if (workspace.role !== "admin") return { error: "Só o administrador pode excluir linhas." };
  if (leadIds.length === 0 || leadIds.length > 500) return { error: "Selecione entre 1 e 500 linhas." };
  try {
    const deleted = await call<number>("lh_delete_leads", { p_token: token, p_lead_ids: leadIds });
    revalidatePath(`/w/${slug}`, "layout");
    return { deleted };
  } catch {
    return { error: "Não foi possível excluir." };
  }
}

export async function createLead(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireWorkspace(slug);
  const name = String(formData.get("name") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return { error: "Telefone inválido. Use DDD + número." };
  if (!name && !phone) return { error: "Informe o nome ou o telefone." };

  await call("lh_create_lead", {
    p_token: token,
    p_name: name,
    p_phone: phone ?? "",
    p_notes: String(formData.get("notes") ?? ""),
  });
  revalidatePath(`/w/${slug}`, "layout");
  return { ok: "Lead adicionado." };
}
