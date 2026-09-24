"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call, DbError } from "@/lib/db";
import { normalizeDomain } from "@/lib/domains";
import { isStatus, parseMoney, type Lead } from "@/lib/leads";
import { normalizePhone } from "@/lib/normalize";
import { requireWorkspace, SESSION_COOKIE } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!slug || !password) return { error: "Informe a empresa e a senha." };

  const result = await call<{ token: string; slug: string } | null>("lh_login", { p_slug: slug, p_password: password });
  if (!result) return { error: "Empresa ou senha incorretos." };

  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(`/w/${result.slug}`);
}

export async function logout(slug: string) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await call("lh_logout", { p_token: token }).catch(() => undefined);
  store.delete(SESSION_COOKIE);
  redirect(`/w/${slug}/entrar`);
}

export type EditableField = "name" | "phone" | "status" | "notes" | "sale_value";

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
    case "name":
    case "notes":
      break;
    default:
      return { error: "Campo não editável." };
  }

  try {
    const lead = await call<Lead>("lh_update_lead", { p_token: token, p_lead_id: leadId, p_patch: { [field]: value } });
    revalidatePath(`/w/${slug}`);
    return { value: lead[field] };
  } catch (error) {
    if (error instanceof DbError && error.code === "LH404") return { error: "Lead não encontrado." };
    return { error: "Não foi possível salvar." };
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
  revalidatePath(`/w/${slug}`);
  return { ok: "Lead adicionado." };
}

export async function updatePage(slug: string, pageId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireWorkspace(slug);
  const rawDomains = String(formData.get("domains") ?? "").split(/[\s,]+/).filter(Boolean);
  const domains = rawDomains.map(normalizeDomain);
  if (domains.some((d) => !d)) return { error: "Domínio inválido. Use algo como clinica.com.br ou *.clinica.com.br." };

  await call("lh_update_page", {
    p_token: token,
    p_page_id: pageId,
    p_name: String(formData.get("name") ?? ""),
    p_domains: [...new Set(domains)],
    p_whatsapp_code: formData.get("whatsapp_code") === "on",
  });
  revalidatePath(`/w/${slug}/instalacao`);
  return { ok: "Configuração salva." };
}
