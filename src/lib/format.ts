import { parsePhoneNumberFromString } from "libphonenumber-js/min";

const TZ = "America/Sao_Paulo";

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(
    new Date(iso),
  );
}

export function timeSince(iso: string, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function formatPhone(phoneNorm: string | null | undefined, fallback?: string | null) {
  if (!phoneNorm) return fallback ?? "—";
  return parsePhoneNumberFromString(phoneNorm)?.formatInternational() ?? phoneNorm;
}

export function formatMoney(value: string | number | null | undefined, currency = "BRL") {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value));
}

export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isWithinDays(iso: string | null | undefined, days: number, now = new Date()) {
  return Boolean(iso) && now.getTime() - new Date(iso as string).getTime() < days * 86_400_000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO -> "2026-09-25T14:30" in São Paulo time, for <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const sp = new Date(new Date(iso).getTime() - 3 * 3_600_000);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}T${pad(sp.getUTCHours())}:${pad(sp.getUTCMinutes())}`;
}

/** "2026-09-25T14:30" typed in São Paulo (UTC-3, no DST since 2019) -> ISO, or null. */
export function fromLocalInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "Hoje 14:30", "Amanhã 09:00", "Ontem 18:00" or "25/09 14:30". */
export function formatWhen(iso: string, now = new Date()) {
  const local = toLocalInput(iso);
  const day = local.slice(0, 10);
  const time = local.slice(11);
  const today = toLocalInput(now.toISOString()).slice(0, 10);
  const shift = (days: number) => toLocalInput(new Date(now.getTime() + days * 86_400_000).toISOString()).slice(0, 10);
  if (day === today) return `Hoje ${time}`;
  if (day === shift(1)) return `Amanhã ${time}`;
  if (day === shift(-1)) return `Ontem ${time}`;
  return `${day.slice(8, 10)}/${day.slice(5, 7)} ${time}`;
}

/** "2026-09-28T09:00" for a follow-up `days` from now at `hour`, São Paulo time. */
export function localAt(days: number, hour: number, now = new Date()) {
  const day = toLocalInput(new Date(now.getTime() + days * 86_400_000).toISOString()).slice(0, 10);
  return `${day}T${String(hour).padStart(2, "0")}:00`;
}
