// Periods of the panel: whole calendar days in São Paulo (UTC-3, no daylight
// saving since 2019), from midnight to midnight. `since`/`until` go to the
// database as [since, until); null means open (all the history / up to now).

export const PERIOD_OPTIONS = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  mes_passado: "Mês passado",
  personalizado: "Personalizado",
  tudo: "Tudo",
} as const;

export type PeriodKey = keyof typeof PERIOD_OPTIONS;

export const DEFAULT_PERIOD: PeriodKey = "30d";

const SP_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_CUSTOM_DAYS = 3 * 366;

/** A calendar day in São Paulo, as "YYYY-MM-DD". */
type Day = string;

export interface Range {
  since: Date | null;
  until: Date | null;
  /** First and last day included, for display. */
  from: Day | null;
  to: Day | null;
}

export interface Period extends Range {
  key: PeriodKey;
  label: string;
  /** Same length right before, for the comparison; null for "Hoje" and "Tudo". */
  previous: Range | null;
  /** Query string values that reproduce this period (periodo, de, ate). */
  query: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in São Paulo. */
export function spToday(now = new Date()): Day {
  const sp = new Date(now.getTime() - SP_OFFSET_MS);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}`;
}

function parseDay(day: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Midnight of that day in São Paulo, as an instant. */
function startOf(day: Day): Date {
  const { y, m, d } = parseDay(day)!;
  return new Date(Date.UTC(y, m - 1, d) + SP_OFFSET_MS);
}

export function addDays(day: Day, n: number): Day {
  const { y, m, d } = parseDay(day)!;
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function firstOfMonth(day: Day, monthsBack = 0): Day {
  const { y, m } = parseDay(day)!;
  const t = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

function daysBetween(from: Day, to: Day): number {
  return Math.round((startOf(to).getTime() - startOf(from).getTime()) / DAY_MS);
}

/** Days `from`..`to`, both included. */
function range(from: Day, to: Day): Range {
  return { since: startOf(from), until: startOf(addDays(to, 1)), from, to };
}

/** The period in the address (?periodo=...&de=...&ate=...), with a safe default. */
export function resolvePeriod(params: { periodo?: string; de?: string; ate?: string }, now = new Date()): Period {
  const today = spToday(now);
  let key: PeriodKey = params.periodo && params.periodo in PERIOD_OPTIONS ? (params.periodo as PeriodKey) : DEFAULT_PERIOD;
  let current: Range;
  let previous: Range | null;
  const query: Record<string, string> = { periodo: key };

  switch (key) {
    case "hoje":
      current = range(today, today);
      previous = null;
      break;
    case "ontem": {
      const y = addDays(today, -1);
      current = range(y, y);
      previous = range(addDays(y, -1), addDays(y, -1));
      break;
    }
    case "7d":
    case "30d": {
      const n = key === "7d" ? 7 : 30;
      current = range(addDays(today, -(n - 1)), today);
      previous = range(addDays(today, -(2 * n - 1)), addDays(today, -n));
      break;
    }
    case "mes": {
      const first = firstOfMonth(today);
      const elapsed = daysBetween(first, today); // 0 on the 1st
      const prevFirst = firstOfMonth(today, 1);
      const prevLast = addDays(first, -1);
      const prevTo = addDays(prevFirst, elapsed);
      current = range(first, today);
      // Same days of last month (1st to the same day), never past its end.
      previous = range(prevFirst, prevTo > prevLast ? prevLast : prevTo);
      break;
    }
    case "mes_passado": {
      const first = firstOfMonth(today, 1);
      current = range(first, addDays(firstOfMonth(today), -1));
      previous = range(firstOfMonth(today, 2), addDays(first, -1));
      break;
    }
    case "personalizado": {
      let from = params.de && parseDay(params.de) ? params.de : null;
      let to = params.ate && parseDay(params.ate) ? params.ate : null;
      if (!from && !to) {
        key = DEFAULT_PERIOD;
        return resolvePeriod({ periodo: DEFAULT_PERIOD }, now);
      }
      from ??= to!;
      to ??= from;
      if (from > to) [from, to] = [to, from];
      if (to > today) to = today;
      if (from > to) from = to;
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS) from = addDays(to, -MAX_CUSTOM_DAYS);
      const length = daysBetween(from, to) + 1;
      current = range(from, to);
      previous = range(addDays(from, -length), addDays(from, -1));
      query.de = from;
      query.ate = to;
      break;
    }
    default:
      current = { since: null, until: null, from: null, to: null };
      previous = null;
  }

  return { key, label: PERIOD_OPTIONS[key], ...current, previous, query };
}

/** Parameters for the lh_* functions. */
export function periodArgs(r: Range) {
  return { p_since: r.since?.toISOString() ?? null, p_until: r.until?.toISOString() ?? null };
}

const MONTHS = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

/** "10 de set.", "1 a 27 de set.", "28 de ago. a 3 de set.", with the year when it is not the current one. */
export function formatRange(r: Range, now = new Date()): string {
  if (!r.from || !r.to) return "todo o histórico";
  const a = parseDay(r.from)!;
  const b = parseDay(r.to)!;
  const thisYear = parseDay(spToday(now))!.y;
  const year = (y: number) => (y === thisYear && a.y === b.y ? "" : ` de ${y}`);
  if (r.from === r.to) return `${a.d} de ${MONTHS[a.m - 1]}${year(a.y)}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} a ${b.d} de ${MONTHS[b.m - 1]}${year(b.y)}`;
  if (a.y === b.y) return `${a.d} de ${MONTHS[a.m - 1]} a ${b.d} de ${MONTHS[b.m - 1]}${year(b.y)}`;
  return `${a.d} de ${MONTHS[a.m - 1]} de ${a.y} a ${b.d} de ${MONTHS[b.m - 1]} de ${b.y}`;
}

export type Trend = { text: string; direction: "up" | "down" | "same" };

/** Change of a count against the previous period: "▲ 12%", "▼ 8%", "=". */
export function countTrend(current: number, previous: number): Trend | null {
  if (!previous && !current) return null;
  if (!previous) return { text: "▲ novo", direction: "up" };
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { text: "= igual", direction: "same" };
  return { text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%`, direction: change > 0 ? "up" : "down" };
}

/** Change of a rate in percent (as `rate()` returns) in percentage points: "▲ 1,4 p.p.". */
export function rateTrend(current: number | null, previous: number | null): Trend | null {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { text: "= igual", direction: "same" };
  return {
    text: `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`,
    direction: diff > 0 ? "up" : "down",
  };
}
