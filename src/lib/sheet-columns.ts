/**
 * Columns of the sheet. The answers of forms and quizzes (lh_leads.extra)
 * each get a column; the admin can rename, hide and reorder them, hide the
 * standard columns and add columns for the attendants to fill in.
 */

export type ColumnKind = "answer" | "custom" | "fixed";

export interface SheetColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  hidden: boolean;
}

export interface SheetConfig {
  columns: SheetColumn[];
  /** The client's internal steps. */
  stages: string[];
  /** Statuses that are sent to Meta (the panel asks before them). */
  meta: { schedule: boolean; purchase: boolean };
  /** Answers found in the client's recent leads, most common first. */
  answers: { key: string; leads: number }[];
}

/** Standard columns that can be hidden (the ones the attendant works with always show). */
export const FIXED_COLUMNS = {
  lp_events: "Eventos na LP",
  origin: "Origem",
  campaign: "Campanha",
  adset: "Conjunto",
  ad: "Anúncio",
  page: "Página",
  device: "Dispositivo",
  clicks: "Cliques",
  notes: "Observações",
} as const;

export type FixedColumn = keyof typeof FIXED_COLUMNS;

/** Saved settings + answers found + standard columns, in display order. */
export function resolveColumns(saved: readonly SheetColumn[] | null | undefined, answers: readonly { key: string }[] = []): SheetColumn[] {
  const columns: SheetColumn[] = [];
  const seen = new Set<string>();
  for (const c of saved ?? []) {
    if (seen.has(c.key) || (c.kind === "fixed" && !(c.key in FIXED_COLUMNS))) continue;
    seen.add(c.key);
    columns.push({ ...c, label: c.label || defaultLabel(c) });
  }
  for (const { key } of answers) {
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ key, label: answerLabel(key), kind: "answer", hidden: false });
  }
  for (const key of Object.keys(FIXED_COLUMNS)) {
    if (!seen.has(key)) columns.push({ key, label: FIXED_COLUMNS[key as FixedColumn], kind: "fixed", hidden: false });
  }
  return columns;
}

function defaultLabel(c: SheetColumn) {
  return c.kind === "fixed" ? FIXED_COLUMNS[c.key as FixedColumn] : answerLabel(c.key);
}

/** Answers and added columns shown in the sheet, in order. */
export const dataColumns = (columns: readonly SheetColumn[]) => columns.filter((c) => c.kind !== "fixed" && !c.hidden);

/** Whether a standard column is shown. */
export const showsFixed = (columns: readonly SheetColumn[], key: FixedColumn) =>
  !columns.some((c) => c.kind === "fixed" && c.key === key && c.hidden);

/**
 * Meta sends the chosen option as written in the form setup
 * ("comprar_para_morar", "recursos_próprios_/_sinal_à_vista"): shown as text.
 */
export function answerValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const text = String(value).trim();
  const optionLike = text.includes("_") || /^[\p{Ll}\d/.-]+$/u.test(text);
  if (!optionLike || /\s/.test(text) || text.includes("@") || text.includes("://")) return text;
  const spaced = text.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "tempo_de_queda" -> "Tempo de queda"; names already written by people ("E-mail") stay. */
export function answerLabel(key: string): string {
  const trimmed = key.trim();
  const text = /\s|[A-ZÀ-Ý]/.test(trimmed) ? trimmed.replace(/_+/g, " ") : trimmed.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
