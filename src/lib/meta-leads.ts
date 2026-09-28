import { graphBase, graphVersion } from "@/lib/meta";
import { normalizePhone } from "@/lib/normalize";

/**
 * Meta Lead Ads (native forms): reads Pages, forms and leads from the Graph
 * API with a client's system user token. Nothing here logs or returns the
 * token, names, phones or answers.
 */

export interface GraphLead {
  id: string;
  created_time: string;
  field_data?: { name: string; values?: string[] }[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
}

export interface FormLead {
  meta_lead_id: string;
  created_time: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  answers: Record<string, string>;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  platform?: string;
  is_organic: boolean;
}

const NAME_FIELDS = ["full_name", "nome_completo", "nome"];
const FIRST_NAME = ["first_name", "primeiro_nome"];
const LAST_NAME = ["last_name", "sobrenome"];
const PHONE_FIELDS = ["phone_number", "telefone", "whatsapp", "celular"];
const EMAIL_FIELDS = ["email", "e-mail"];
const STANDARD_LABELS: Record<string, string> = {
  city: "Cidade",
  state: "Estado",
  zip_code: "CEP",
  post_code: "CEP",
  street_address: "Endereço",
  company_name: "Empresa",
  job_title: "Cargo",
  date_of_birth: "Data de nascimento",
};

/** "qual_o_seu_orçamento?" -> "Qual o seu orçamento?" */
export function questionLabel(key: string): string {
  if (STANDARD_LABELS[key]) return STANDARD_LABELS[key];
  const text = key.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 120);
}

/** One Graph API lead -> the row the sheet stores. */
export function parseLead(raw: GraphLead): FormLead {
  const fields = new Map<string, string>();
  for (const f of raw.field_data ?? []) {
    const value = (f.values ?? []).filter(Boolean).join(", ").trim();
    if (f.name && value) fields.set(f.name.toLowerCase(), value.slice(0, 500));
  }
  const take = (keys: string[]) => {
    for (const k of keys) {
      const v = fields.get(k);
      if (v) {
        fields.delete(k);
        return v;
      }
    }
    return null;
  };
  let name = take(NAME_FIELDS);
  const first = take(FIRST_NAME);
  const last = take(LAST_NAME);
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(" ");
  const rawPhone = take(PHONE_FIELDS);
  const phone = rawPhone ? (normalizePhone(rawPhone) ?? rawPhone.replace(/[^\d+]/g, "").slice(0, 20)) || null : null;
  const email = take(EMAIL_FIELDS)?.toLowerCase() ?? null;

  const answers: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of fields) {
    if (count++ >= 30) break;
    answers[questionLabel(key)] = value;
  }
  if (email) answers["E-mail"] = email;

  return {
    meta_lead_id: raw.id,
    created_time: raw.created_time,
    name: name?.slice(0, 120) ?? null,
    phone,
    email,
    answers,
    campaign_id: raw.campaign_id,
    campaign_name: raw.campaign_name,
    adset_id: raw.adset_id,
    adset_name: raw.adset_name,
    ad_id: raw.ad_id,
    ad_name: raw.ad_name,
    platform: raw.platform,
    is_organic: raw.is_organic === true,
  };
}

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** GET on the Graph API; the token goes in the Authorization header, never in logs or errors. */
async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const url = new URL(`${graphBase()}/${graphVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GraphError("Não foi possível falar com a Meta.");
  }
  const body = (await res.json().catch(() => null)) as ({ error?: { message?: string; code?: number } } & T) | null;
  if (!res.ok || !body || body.error) {
    const message = (body?.error?.message ?? `HTTP ${res.status}`).split(token).join("***").slice(0, 200);
    throw new GraphError(message, body?.error?.code);
  }
  return body;
}

/** Pages the token can see (the system user's assigned Pages). */
export async function listPages(token: string, fetchImpl?: typeof fetch) {
  const body = await graphGet<{ data: { id: string; name: string }[] }>("me/accounts", token, { fields: "id,name", limit: "100" }, fetchImpl);
  return body.data.map((p) => ({ id: p.id, name: p.name }));
}

/** The Page's own token, needed to read its forms and leads. */
export async function pageToken(token: string, pageId: string, fetchImpl?: typeof fetch) {
  const body = await graphGet<{ access_token?: string }>(encodeURIComponent(pageId), token, { fields: "access_token" }, fetchImpl);
  if (!body.access_token) throw new GraphError("Sem acesso a esta Página: confira se ela foi atribuída ao usuário do sistema.");
  return body.access_token;
}

export async function listForms(token: string, pageId: string, fetchImpl?: typeof fetch) {
  const pt = await pageToken(token, pageId, fetchImpl);
  const body = await graphGet<{ data: { id: string; name: string; status: string; leads_count?: number }[] }>(
    `${encodeURIComponent(pageId)}/leadgen_forms`,
    pt,
    { fields: "id,name,status,leads_count", limit: "100" },
    fetchImpl,
  );
  return body.data.map((f) => ({ id: f.id, name: f.name, status: f.status, leads: f.leads_count ?? null }));
}

const LEAD_FIELDS = "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic";

/** Leads of a form created after `since` (unix seconds), oldest first, up to `max`. */
export async function fetchLeadsSince(pt: string, formId: string, since: number, max = 500, fetchImpl?: typeof fetch): Promise<GraphLead[]> {
  const leads: GraphLead[] = [];
  let after: string | undefined;
  do {
    const body = await graphGet<{ data: GraphLead[]; paging?: { cursors?: { after?: string }; next?: string } }>(
      `${encodeURIComponent(formId)}/leads`,
      pt,
      {
        fields: LEAD_FIELDS,
        limit: "100",
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]),
        ...(after && { after }),
      },
      fetchImpl,
    );
    leads.push(...body.data);
    after = body.paging?.next ? body.paging.cursors?.after : undefined;
  } while (after && leads.length < max);
  return leads.sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
}

/** Friendly Portuguese for the errors people can fix. */
export function explainGraphError(error: unknown): string {
  if (!(error instanceof GraphError)) return "Erro inesperado ao falar com a Meta.";
  if (error.code === 190) return "Token inválido ou expirado: gere um novo token do usuário do sistema.";
  if (error.code === 10 || error.code === 200 || error.code === 283)
    return "Sem permissão: o token precisa de leads_retrieval e acesso a leads da Página (Central de acesso a leads).";
  if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613) return "A Meta pediu para esperar (limite de chamadas). Tenta de novo sozinho.";
  return `Meta: ${error.message}`;
}
