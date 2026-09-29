/**
 * Conversions back to Google Ads through a scheduled file upload: Google Ads
 * fetches this file (HTTPS, user and password) and imports the conversions of
 * the leads that came from a Google ad click (gclid).
 */

export interface GoogleAdsRow {
  gclid: string;
  name: string;
  /** "YYYY-MM-DD HH:MM:SS", São Paulo time. */
  time: string;
  value: number | null;
}

export interface GoogleAdsSettings {
  feed_id: string;
  username: string;
  enabled: boolean;
  lead_name: string;
  schedule_name: string;
  purchase_name: string;
  send_lead: boolean;
  send_schedule: boolean;
  send_purchase: boolean;
  created_at: string;
  last_fetch_at: string | null;
  last_rows: number | null;
  with_gclid_90d: number;
  /** Only right after it is generated. */
  password?: string;
}

const cell = (value: string) => {
  // Neutralise spreadsheet formulas and quote when needed.
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Google Ads "conversions from clicks" file (the standard template). */
export function googleAdsCsv(rows: readonly GoogleAdsRow[]): string {
  const lines = [
    "Parameters:TimeZone=America/Sao_Paulo",
    "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
    ...rows.map((r) =>
      [cell(r.gclid), cell(r.name), r.time, r.value === null || r.value === undefined ? "" : Number(r.value).toFixed(2), r.value ? "BRL" : ""].join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** "Authorization: Basic ..." -> user and password (null when absent or malformed). */
export function basicAuth(header: string | null): { username: string; password: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header?.trim() ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1) return null;
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}
