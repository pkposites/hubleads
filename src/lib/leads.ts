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
  source: "lp" | "manual";
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
  created_at: string;
  updated_at: string;
}

export interface Stats {
  visitors: number;
  clicks: number;
  leads: number;
  with_phone: number;
  sales: number;
  revenue: number;
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

export const PERIODS = {
  hoje: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  tudo: "Tudo",
} as const;

export type Period = keyof typeof PERIODS;

export function periodStart(period: string, now = new Date()): Date | null {
  if (period === "tudo") return null;
  if (period === "hoje") {
    // Midnight in São Paulo (UTC-3, no DST since 2019).
    const sp = new Date(now.getTime() - 3 * 3_600_000);
    return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate(), 3));
  }
  const days = period === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000);
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

const CSV_COLUMNS: [string, (l: Lead) => unknown][] = [
  ["Data/hora do clique", (l) => l.created_at],
  ["Código", (l) => l.code],
  ["Nome", (l) => l.name],
  ["Telefone", (l) => l.phone],
  ["Status", (l) => STATUSES[l.status]],
  ["Valor da venda", (l) => l.sale_value],
  ["Observações", (l) => l.notes],
  ["Origem", (l) => channelLabel(l.channel)],
  ["utm_source", (l) => l.utm_source],
  ["utm_medium", (l) => l.utm_medium],
  ["utm_campaign", (l) => l.utm_campaign],
  ["utm_content", (l) => l.utm_content],
  ["utm_term", (l) => l.utm_term],
  ["campaign_id", (l) => l.campaign_id],
  ["adset_id", (l) => l.adset_id],
  ["ad_id", (l) => l.ad_id],
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
  ["Entrada", (l) => (l.source === "manual" ? "Manual" : "Landing Page")],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Semicolon-separated with a BOM, which Excel in pt-BR opens correctly. */
export function leadsToCsv(leads: readonly Lead[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(";")];
  for (const lead of leads) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(lead))).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
