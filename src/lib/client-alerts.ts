import { createHash } from "node:crypto";

/** What the painel mãe needs of a client to judge whether data is arriving. */
export interface ClientActivityInput {
  id: string;
  name: string;
  created_at: string;
  last_lead_at: string | null;
  /** Last landing page event (visit or click). */
  last_event_at: string | null;
}

export type Activity = "recebendo" | "parado" | "aguardando";

export const ACTIVITY_LABEL: Record<Activity, string> = {
  recebendo: "Recebendo dados",
  parado: "Sem dados há 3+ dias",
  aguardando: "Aguardando instalação",
};

const latest = (c: ClientActivityInput) =>
  [c.last_lead_at, c.last_event_at].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;

/**
 * Any source counts: landing page events, and leads from forms, sheets or by
 * hand. "Aguardando" only when nothing ever arrived.
 */
export function clientActivity(c: ClientActivityInput, now = new Date()): Activity {
  const last = latest(c);
  if (!last) return "aguardando";
  return now.getTime() - new Date(last).getTime() < 3 * 86_400_000 ? "recebendo" : "parado";
}

export interface IdleClient {
  id: string;
  name: string;
  /** Last lead, or null when the client never had one. */
  lastLeadAt: string | null;
  hours: number;
}

/** Clients without a new lead for more than `hours` (default 20 h), longest first. */
export function idleClients(clients: readonly ClientActivityInput[], now = new Date(), hours = 20): IdleClient[] {
  return clients
    .map((c) => {
      const since = c.last_lead_at ?? c.created_at;
      return { id: c.id, name: c.name, lastLeadAt: c.last_lead_at, hours: Math.floor((now.getTime() - new Date(since).getTime()) / 3_600_000) };
    })
    .filter((c) => c.hours > hours)
    .sort((a, b) => b.hours - a.hours);
}

/** "26 h" / "3 dias e 4 h". */
export function formatIdle(hours: number) {
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `${days} dias${rest ? ` e ${rest} h` : ""}`;
}

/**
 * Short fingerprint of what an alert says: a hidden alert comes back when it
 * changes (another client idle, a new lead and then idle again...).
 */
export function alertSignature(parts: readonly unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 12);
}
