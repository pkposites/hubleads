/**
 * When should Lead Hub leave the shared Supabase project? Turns the numbers
 * from lh_admin_infra into a level and plain reasons for the admin panel.
 */

export interface InfraNumbers {
  other_tables: number;
  db_bytes: number;
  lh_bytes: number;
  clients: number;
  leads: number;
  events: number;
  events_7d: number;
  bytes_per_day: number;
}

export type InfraLevel = "ok" | "atencao" | "trocar";

export interface InfraStatus {
  level: InfraLevel;
  shared: boolean;
  reasons: string[];
  dbPercent: number;
  daysToLimit: number | null;
}

const MB = 1024 * 1024;

/** Database size limit of the plan, in MB (Supabase Free: 500 MB). */
export const dbLimitMb = (raw = process.env.LH_DB_LIMIT_MB) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 500;
};

export const formatMb = (bytes: number) =>
  bytes >= 1024 * MB
    ? `${(bytes / (1024 * MB)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`
    : `${(bytes / MB).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

export function evaluateInfra(n: InfraNumbers, limitMb: number): InfraStatus {
  const limit = limitMb * MB;
  const shared = n.other_tables > 0;
  const dbPercent = Math.round((n.db_bytes / limit) * 100);
  const daysToLimit = n.bytes_per_day > 0 ? Math.max(0, Math.floor((limit - n.db_bytes) / n.bytes_per_day)) : null;

  const red: string[] = [];
  const amber: string[] = [];
  const space = `O banco está com ${dbPercent}% do limite do plano (${formatMb(n.db_bytes)} de ${formatMb(limit)}).`;
  if (dbPercent >= 80) red.push(space);
  else if (dbPercent >= 60) amber.push(space);
  if (daysToLimit !== null && daysToLimit < 30) red.push(`No ritmo atual, o espaço acaba em cerca de ${daysToLimit} dias.`);
  else if (daysToLimit !== null && daysToLimit < 90) amber.push(`No ritmo atual, o espaço acaba em cerca de ${daysToLimit} dias.`);

  // Size and number of clients only matter while another system shares the project.
  if (shared) {
    if (n.clients >= 5) red.push(`${n.clients} clientes já dependem do projeto compartilhado.`);
    else if (n.clients >= 3) amber.push(`${n.clients} clientes já dependem do projeto compartilhado.`);
    if (n.leads >= 2000) red.push(`${n.leads.toLocaleString("pt-BR")} leads: a migração fica mais demorada a cada semana.`);
    else if (n.leads >= 500) amber.push(`${n.leads.toLocaleString("pt-BR")} leads: a migração começa a ficar mais trabalhosa.`);
    if (n.lh_bytes >= 150 * MB) red.push(`O Lead Hub já ocupa ${formatMb(n.lh_bytes)} do banco compartilhado.`);
    else if (n.lh_bytes >= 50 * MB) amber.push(`O Lead Hub já ocupa ${formatMb(n.lh_bytes)} do banco compartilhado.`);
  }

  const level: InfraLevel = red.length ? "trocar" : amber.length ? "atencao" : "ok";
  return { level, shared, reasons: [...red, ...amber], dbPercent, daysToLimit };
}
