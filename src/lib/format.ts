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
