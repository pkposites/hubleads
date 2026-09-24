export type Role = "admin" | "manager" | "sales" | "client" | "agent";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Gestor",
  sales: "Comercial",
  client: "Cliente",
  agent: "Atendente",
};

export const canManage = (role: Role) => role === "admin" || role === "manager";
export const canEditLeads = (role: Role) => role !== "client";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  created_at: string;
}

export interface Stage {
  id: string;
  project_id: string;
  key: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
  event_type: string | null;
}

export type Touch = Record<string, string | undefined> & { channel?: string };

export interface Lead {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string | null;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  email_norm: string | null;
  current_stage_id: string | null;
  owner_id: string | null;
  estimated_value: string | null;
  sale_value: string | null;
  currency: string;
  lost_reason: string | null;
  needs_review: boolean;
  first_touch: Touch;
  last_touch: Touch;
  source_channel: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversion {
  id: string;
  form_id: string | null;
  source_channel: string | null;
  answers: Record<string, string>;
  tracking: Record<string, unknown>;
  consent: Record<string, unknown>;
  created_at: string;
}

export interface StageHistory {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  changed_by: string | null;
  metadata: { lost_reason?: string; sale_value?: number; reason?: string };
  created_at: string;
}

export interface LandingPage {
  id: string;
  project_id: string;
  name: string;
  domains: string[];
  public_key: string;
  status: string;
  created_at: string;
}

export interface Form {
  id: string;
  project_id: string;
  name: string;
  key: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export type ActionState = { error?: string; ok?: string; secret?: string } | undefined;
