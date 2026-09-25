export interface PublicPrivacy {
  name: string;
  slug: string;
  controller: string;
  document: string | null;
  email: string | null;
  retention_months: number;
  updated_at: string;
  meta: boolean;
}

export interface AuditEntry {
  action: string;
  actor: string;
  detail: Record<string, unknown>;
  at: string;
}

export interface PrivacySettings {
  controller: string | null;
  document: string | null;
  email: string | null;
  retention_months: number;
  updated_at: string | null;
  audit: AuditEntry[];
}

const ACTOR: Record<string, string> = { admin: "Administrador", atendente: "Atendente", sistema: "Sistema" };

/** One line for the audit log shown in the admin panel. */
export function describeAudit(a: AuditEntry): string {
  const who = ACTOR[a.actor] ?? a.actor;
  const n = (key: string) => Number(a.detail?.[key] ?? 0);
  switch (a.action) {
    case "export_csv":
      return `${who} exportou a planilha (${n("rows")} ${n("rows") === 1 ? "linha" : "linhas"})`;
    case "export_lead":
      return `${who} exportou os dados do lead ${String(a.detail?.code ?? "")} (pedido do titular)`;
    case "delete_leads":
      return a.actor === "sistema"
        ? `Prazo de guarda: ${n("count")} ${n("count") === 1 ? "lead apagado" : "leads apagados"} automaticamente`
        : `${who} excluiu ${n("count")} ${n("count") === 1 ? "linha" : "linhas"}`;
    default:
      return `${who}: ${a.action}`;
  }
}
