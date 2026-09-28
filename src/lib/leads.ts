import { sourceLabel } from "@/lib/source-labels";
import { channelLabel } from "@/lib/attribution";

export const STATUSES = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  agendado: "Agendado",
  venda: "Venda",
  perdido: "Perdido",
} as const;

export type Status = keyof typeof STATUSES;

export const isStatus = (value: unknown): value is Status =>
  typeof value === "string" && Object.hasOwn(STATUSES, value);

export interface Lead {
  id: string;
  page_id: string | null;
  source: "lp" | "manual" | "meta_form" | "sheets";
  code: string;
  name: string | null;
  phone: string | null;
  status: Status;
  notes: string | null;
  sale_value: number | null;
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  ad_name: string | null;
  placement: string | null;
  site_source_name: string | null;
  url_params: Record<string, unknown>;
  fbclid: string | null;
  gclid: string | null;
  fbc: string | null;
  fbp: string | null;
  landing_url: string | null;
  referrer: string | null;
  device: string | null;
  first_seen_at: string | null;
  clicks: number;
  last_click_at: string;
  extra: Record<string, unknown>;
  first_contact_at: string | null;
  next_contact_at: string | null;
  lost_reason: string | null;
  /** Internal step (never sent to Meta). */
  stage: string | null;
  /** Good / medium / bad mark. */
  color: LeadColor | null;
  created_at: string;
  updated_at: string;
}

/** Marks for good and bad leads (only for the team). */
export const COLORS = {
  verde: { label: "Bom", dot: "bg-emerald-500", row: "bg-emerald-50/70", border: "border-l-emerald-500" },
  amarelo: { label: "Médio", dot: "bg-amber-400", row: "bg-amber-50/70", border: "border-l-amber-400" },
  vermelho: { label: "Ruim", dot: "bg-red-500", row: "bg-red-50/70", border: "border-l-red-500" },
} as const;

export type LeadColor = keyof typeof COLORS;

export const isColor = (value: unknown): value is LeadColor => typeof value === "string" && Object.hasOwn(COLORS, value);

export const LOST_REASONS = [
  "Sem resposta",
  "Preço",
  "Sem interesse",
  "Fechou com outro",
  "Fora da região",
  "Só pesquisando",
  "Contato inválido",
] as const;

export interface Template {
  id: string;
  name: string;
  body: string;
  position: number;
}

/** Fills {nome} (first name) and {empresa} in a ready-made message. */
export function fillTemplate(body: string, values: { name: string | null; company: string }) {
  const first = values.name?.trim().split(/\s+/)[0] ?? "";
  return body
    .replace(/\{nome\}/gi, first)
    .replace(/\{empresa\}/gi, values.company)
    .replace(/,\s*!/g, "!")
    .replace(/\s+([!?,.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface Queue {
  waiting: Lead[];
  overdue: Lead[];
  today: Lead[];
}

export interface HistoryEntry {
  type: string;
  from: string | null;
  to: string | null;
  actor: string;
  at: string;
}

export interface AttendanceMetrics {
  first_contact_median_min: number | null;
  contacted: number;
  within_5_min: number;
  waiting: number;
  lost_reasons: { reason: string; count: number }[];
}

/** "12 min", "2 h 5 min", "3 dias". */
export function formatMinutes(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const m = Math.round(Number(minutes));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const days = Math.round(m / (24 * 60));
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

export interface SourceNumbers {
  source: string;
  leads: number;
  with_phone: number;
  scheduled: number;
  sales: number;
  revenue: number;
}

export interface Stats {
  visitors: number;
  clicks: number;
  leads: number;
  with_phone: number;
  sales: number;
  revenue: number;
  /** Leads of the period by where they came from (lp, meta_form, sheets, manual). */
  by_source?: SourceNumbers[];
}

export interface LeadEvent {
  id: number;
  page_id: string;
  lead_id: string | null;
  visitor_id: string | null;
  type: string;
  url: string | null;
  data: { channel?: string; device?: string; title?: string; code?: string; utm_campaign?: string; data?: unknown };
  created_at: string;
}

export interface Page {
  id: string;
  name: string;
  public_key: string;
  domains: string[];
  whatsapp_code: boolean;
  created_at: string;
}

/** "18.000,50" / "18000.5" / "R$ 18.000" -> 18000.5; null when empty or invalid. */
export function parseMoney(raw: string): number | null | "invalid" {
  const cleaned = raw.replace(/[R$\s]/g, "");
  if (!cleaned) return null;
  // Brazilian format: "." groups thousands, "," is the decimal separator.
  const thousandsOnly = /^\d{1,3}(\.\d{3})+$/.test(cleaned);
  const normalized =
    cleaned.includes(",") || thousandsOnly ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : "invalid";
}

/** Keys the tracker adds for itself; not answers from the page. */
const INTERNAL_EXTRA = new Set(["whatsapp_url"]);

/** Answers the landing page sent with the click (quiz, form steps). */
export function answerEntries(extra: Record<string, unknown> | null | undefined): [string, string][] {
  return Object.entries(extra ?? {})
    .filter(([key, value]) => !INTERNAL_EXTRA.has(key) && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => [key, typeof value === "boolean" ? (value ? "Sim" : "Não") : String(value)]);
}

import { answerLabel, answerValue, type SheetColumn } from "@/lib/sheet-columns";

export { answerLabel };

/** Meta ads usually send names in utm_* (campaign / term = ad set / content = ad). */
export function adNames(l: Lead) {
  return {
    campaign: l.campaign_name || l.utm_campaign,
    adset: l.adset_name || l.utm_term,
    ad: l.ad_name || l.utm_content,
  };
}

const CSV_COLUMNS: [string, (l: Lead) => unknown][] = [
  ["Data/hora de entrada", (l) => l.created_at],
  ["Fonte", (l) => sourceLabel(l.source)],
  ["Código", (l) => l.code],
  ["Nome", (l) => l.name],
  ["Telefone", (l) => l.phone],
  ["Status", (l) => STATUSES[l.status]],
  ["Valor da venda", (l) => l.sale_value],
  ["Observações", (l) => l.notes],
  ["Motivo da perda", (l) => l.lost_reason],
  ["Próximo contato", (l) => l.next_contact_at],
  ["Primeiro contato", (l) => l.first_contact_at],
  ["Etapa", (l) => l.stage],
  ["Qualidade", (l) => (l.color ? COLORS[l.color].label : "")],
  ["Origem", (l) => channelLabel(l.channel)],
  ["Campanha", (l) => adNames(l).campaign],
  ["Conjunto", (l) => adNames(l).adset],
  ["Anúncio", (l) => adNames(l).ad],
  ["utm_source", (l) => l.utm_source],
  ["utm_medium", (l) => l.utm_medium],
  ["utm_campaign", (l) => l.utm_campaign],
  ["utm_content", (l) => l.utm_content],
  ["utm_term", (l) => l.utm_term],
  ["campaign_id", (l) => l.campaign_id],
  ["adset_id", (l) => l.adset_id],
  ["ad_id", (l) => l.ad_id],
  ["campaign_name", (l) => l.campaign_name],
  ["adset_name", (l) => l.adset_name],
  ["ad_name", (l) => l.ad_name],
  ["placement", (l) => l.placement],
  ["site_source_name", (l) => l.site_source_name],
  ["gclid", (l) => l.gclid],
  ["fbclid", (l) => l.fbclid],
  ["fbc", (l) => l.fbc],
  ["fbp", (l) => l.fbp],
  ["Página", (l) => l.landing_url],
  ["Referrer", (l) => l.referrer],
  ["Dispositivo", (l) => l.device],
  ["Cliques", (l) => l.clicks],
  ["Último clique", (l) => l.last_click_at],
  ["Primeira visita", (l) => l.first_seen_at],
  ["Entrada", (l) => sourceLabel(l.source)],
  ["Parâmetros da URL", (l) => (l.url_params && Object.keys(l.url_params).length ? JSON.stringify(l.url_params) : "")],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Semicolon-separated with a BOM, which Excel in pt-BR opens correctly. */
export function leadsToCsv(leads: readonly Lead[], sheetColumns: readonly SheetColumn[] = []): string {
  // One column per answer / added column: in the client's order and names,
  // then any other answer found in the exported rows. Hidden ones are kept
  // (the export is the complete record).
  const found = new Set(leads.flatMap((l) => answerEntries(l.extra).map(([k]) => k)));
  const named = sheetColumns.filter((c) => c.kind !== "fixed");
  const keys = [...named.map((c) => c.key), ...[...found].filter((k) => !named.some((c) => c.key === k))];
  const columns: [string, (l: Lead) => unknown][] = [
    ...CSV_COLUMNS,
    ...keys.map((key): [string, (l: Lead) => unknown] => [
      named.find((c) => c.key === key)?.label || answerLabel(key),
      (l) => answerValue(answerEntries(l.extra).find(([k]) => k === key)?.[1]),
    ]),
  ];
  const lines = [columns.map(([h]) => csvCell(h)).join(";")];
  for (const lead of leads) lines.push(columns.map(([, get]) => csvCell(get(lead))).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const DIMENSIONS = {
  channel: "Origem",
  campaign: "Campanha",
  adset: "Conjunto",
  ad: "Anúncio",
  device: "Dispositivo",
} as const;

export type Dimension = keyof typeof DIMENSIONS;

export interface MetricsRow {
  key: string;
  visitors: number;
  clickers: number;
  leads: number;
  with_phone: number;
  scheduled: number;
  sales: number;
  revenue: number;
}

export interface Metrics {
  totals: Omit<MetricsRow, "key"> & { clicks: number; manual_leads: number };
  rows: MetricsRow[];
  daily: { day: string; visitors: number; clickers: number }[];
  by_source?: SourceNumbers[];
}

/** Share as a whole percentage, or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

export const formatRate = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
