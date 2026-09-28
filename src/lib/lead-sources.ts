import { createHash } from "node:crypto";
import { questionLabel } from "@/lib/meta-leads";
import { normalizePhone } from "@/lib/normalize";

export { SOURCE_LABELS, sourceLabel, type LeadSourceKind } from "@/lib/source-labels";

/**
 * Lead sources besides the landing pages. A row of a Google Sheet (usually
 * the sheet Meta's native form integration fills) becomes a lead: Meta's own
 * headers (id, full_name, phone_number, campaign_name...) and common
 * Portuguese ones (nome, telefone, e-mail...) are understood; any other
 * column becomes an answer in the sheet.
 */

export interface SourceLead {
  meta_lead_id: string | null;
  external_id: string | null;
  created_time: string | null;
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
  form_id?: string;
  form_name?: string;
  platform?: string;
  is_organic?: boolean;
  channel?: string;
}

/** "Nome Completo" / "full_name" / "E-mail" -> "nome_completo" / "full_name" / "e_mail". */
export function headerKey(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const ALIASES: Record<string, string[]> = {
  id: ["id", "lead_id", "id_do_lead"],
  created_time: ["created_time", "data", "data_de_criacao", "criado_em", "date", "timestamp", "carimbo_de_data_hora"],
  name: ["full_name", "nome_completo", "nome", "name", "seu_nome"],
  first_name: ["first_name", "primeiro_nome"],
  last_name: ["last_name", "sobrenome"],
  phone: ["phone_number", "phone", "telefone", "whatsapp", "celular", "numero_de_telefone", "seu_whatsapp", "telefone_whatsapp"],
  email: ["email", "e_mail", "seu_email"],
  campaign_id: ["campaign_id"],
  campaign_name: ["campaign_name", "campanha"],
  adset_id: ["adset_id"],
  adset_name: ["adset_name", "conjunto", "conjunto_de_anuncios"],
  ad_id: ["ad_id"],
  ad_name: ["ad_name", "anuncio"],
  form_id: ["form_id"],
  form_name: ["form_name", "formulario"],
  platform: ["platform", "plataforma"],
  is_organic: ["is_organic"],
};

/** Columns Meta adds that are not answers. */
const IGNORED = new Set(["lead_status", "inbox_url", "retailer_item_id", "vehicle", "home_listing", "partner_name", "custom_disclaimer_responses"]);

/** Meta prefixes ids and phones in its exports: "l:123", "p:+55...", "ag:", "as:", "c:", "f:". */
const unprefix = (value: string) => value.replace(/^(l|p|ag|as|c|f):/i, "").trim();

/** One spreadsheet row (header -> value) -> the lead to store; null for empty rows. */
export function mapSheetRow(row: Record<string, unknown>, sourceId: string): SourceLead | null {
  const fields = new Map<string, { header: string; value: string }>();
  for (const [header, raw] of Object.entries(row)) {
    const value = String(raw ?? "").trim();
    if (!header || !value) continue;
    fields.set(headerKey(header), { header, value: value.slice(0, 500) });
  }
  const take = (field: string) => {
    for (const key of ALIASES[field]) {
      const found = fields.get(key);
      if (found) {
        fields.delete(key);
        return found.value;
      }
    }
    return undefined;
  };

  const rawId = take("id");
  const metaId = rawId ? unprefix(rawId) : "";
  const createdRaw = take("created_time");
  let name = take("name") ?? null;
  const first = take("first_name");
  const last = take("last_name");
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(" ");
  const rawPhone = take("phone");
  const phoneText = rawPhone ? unprefix(rawPhone) : "";
  const phone = phoneText ? (normalizePhone(phoneText) ?? phoneText.replace(/[^\d+]/g, "").slice(0, 20)) || null : null;
  const email = take("email")?.toLowerCase() ?? null;
  const organic = take("is_organic");

  const extra = {
    campaign_id: take("campaign_id"),
    campaign_name: take("campaign_name"),
    adset_id: take("adset_id"),
    adset_name: take("adset_name"),
    ad_id: take("ad_id"),
    ad_name: take("ad_name"),
    form_id: take("form_id"),
    form_name: take("form_name"),
    platform: take("platform"),
  };
  for (const key of ["campaign_id", "adset_id", "ad_id", "form_id"] as const) if (extra[key]) extra[key] = unprefix(extra[key]!);

  const answers: Record<string, string> = {};
  let count = 0;
  for (const [key, { header, value }] of fields) {
    if (IGNORED.has(key) || count >= 30) continue;
    answers[/[A-Z ]/.test(header) ? header.slice(0, 60) : questionLabel(header)] = value;
    count++;
  }
  if (email) answers["E-mail"] = email;

  if (!name && !phone && !email) return null;

  const created = createdRaw ? new Date(createdRaw) : null;
  const isMeta = /^\d{5,30}$/.test(metaId);
  return {
    meta_lead_id: isMeta ? metaId : null,
    // Without a Meta id, the same row sent twice is recognised by its content.
    external_id: isMeta
      ? null
      : `row:${createHash("sha256").update([sourceId, name, phone, email, createdRaw].join("|")).digest("hex").slice(0, 40)}`,
    created_time: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
    name: name?.slice(0, 120) ?? null,
    phone,
    email,
    answers,
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)),
    ...(organic !== undefined && { is_organic: /^(true|1|sim|yes)$/i.test(organic) }),
    ...(!isMeta && extra.campaign_name && { channel: "meta_ads" }),
  };
}

/** The Apps Script the admin pastes in the sheet (Extensões → Apps Script). */
export function appsScript(endpoint: string, key: string) {
  return `// Lead Hub: envia as linhas novas desta planilha para o Lead Hub, a cada minuto.
// 1. Cole este código em Extensões → Apps Script (apague o que estiver lá) e salve.
// 2. No menu de funções, escolha "instalar" e clique em Executar. Autorize com a sua conta Google.
// Pronto: a partir daí, cada linha nova (ex.: lead do formulário da Meta) vai para o Lead Hub.
// Para mandar também as linhas que já estão na planilha, execute "importarTudo" uma vez.

const LEAD_HUB_URL = ${JSON.stringify(endpoint)};
const LEAD_HUB_KEY = ${JSON.stringify(key)}; // chave secreta desta planilha: não compartilhe
const ABA = ""; // nome da aba com os leads; vazio = a primeira aba

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "enviarLeads") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarLeads").timeBased().everyMinutes(1).create();
  // Começa pelas linhas novas; as que já existem ficam de fora (use importarTudo para mandá-las).
  PropertiesService.getScriptProperties().setProperty("ultimaLinha", String(aba_().getLastRow()));
  console.log("Lead Hub instalado. As próximas linhas serão enviadas a cada minuto.");
}

function importarTudo() {
  PropertiesService.getScriptProperties().setProperty("ultimaLinha", "1");
  enviarLeads();
}

function aba_() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  return ABA ? planilha.getSheetByName(ABA) : planilha.getSheets()[0];
}

function enviarLeads() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(5000)) return;
  try {
    var aba = aba_();
    var props = PropertiesService.getScriptProperties();
    var ultima = Number(props.getProperty("ultimaLinha") || "1");
    var total = aba.getLastRow();
    while (total > ultima) {
      var fim = Math.min(total, ultima + 100);
      var cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getDisplayValues()[0];
      var valores = aba.getRange(ultima + 1, 1, fim - ultima, cabecalho.length).getDisplayValues();
      var linhas = valores.map(function (linha) {
        var obj = {};
        cabecalho.forEach(function (titulo, i) {
          if (titulo && linha[i] !== "") obj[titulo] = linha[i];
        });
        return obj;
      });
      var resposta = UrlFetchApp.fetch(LEAD_HUB_URL, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + LEAD_HUB_KEY },
        payload: JSON.stringify({ rows: linhas }),
        muteHttpExceptions: true,
      });
      if (resposta.getResponseCode() !== 200) {
        // Tenta de novo no próximo minuto, a partir das mesmas linhas.
        console.log("Lead Hub respondeu " + resposta.getResponseCode() + ": " + resposta.getContentText().slice(0, 200));
        return;
      }
      ultima = fim;
      props.setProperty("ultimaLinha", String(ultima));
    }
  } finally {
    trava.releaseLock();
  }
}
`;
}
