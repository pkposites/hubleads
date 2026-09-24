import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vitest";

export function createPool() {
  return new Pool({ connectionString: inject("dbUrl"), max: 4 });
}

/** Calls a function as the `anon` role, like the app does with the publishable key. */
export async function anon<T = unknown>(pool: Pool, sql: string, params: unknown[] = []): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("set local role anon");
    const { rows } = await db.query(sql, params);
    await db.query("commit");
    return rows[0]?.r as T;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

/** Creates an admin and returns an admin session token. */
export async function setupAdmin(pool: Pool) {
  const login = `admin-${randomUUID().slice(0, 8)}@example.com`;
  const password = `admin-senha-${randomUUID().slice(0, 8)}`;
  await pool.query("select lh_private.create_admin($1, $2)", [login, password]);
  const session = await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [login, password]);
  return { login, password, token: session.token };
}

export interface Setup {
  workspaceId: string;
  pageId: string;
  key: string;
  slug: string;
  password: string;
  token: string;
}

export async function setupWorkspace(pool: Pool, name = "Dra Letícia"): Promise<Setup> {
  const slug = `ws-${randomUUID().slice(0, 8)}`;
  const password = `senha-${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query(
    "select lh_private.create_workspace($1, $2, $3, 'LP principal') as r",
    [name, slug, password],
  );
  const { workspace_id, page_id, public_key } = rows[0].r;
  const login = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [slug, password]);
  return { workspaceId: workspace_id, pageId: page_id, key: public_key, slug, password, token: login.token };
}

export interface CollectEvent {
  type: string;
  visitor_id: string;
  url?: string;
  name?: string;
  phone?: string;
  code?: string;
  channel?: string;
  device?: string;
  attribution?: Record<string, string>;
  url_params?: Record<string, string>;
  ip_address?: string;
  user_agent?: string;
  data?: Record<string, unknown>;
}

export const collect = (pool: Pool, key: string, event: CollectEvent, host = "clinica.com.br") =>
  anon<{ ok: boolean; lead_id?: string; code?: string; new_lead?: boolean }>(
    pool,
    "select lh_collect($1, $2, $3) as r",
    [key, host, JSON.stringify(event)],
  );

export interface LeadRow {
  id: string;
  extra: Record<string, unknown>;
  code: string;
  name: string | null;
  phone: string | null;
  status: string;
  notes: string | null;
  sale_value: number | null;
  channel: string | null;
  utm_campaign: string | null;
  ad_id: string | null;
  fbc: string | null;
  clicks: number;
  source: string;
}

export const listLeads = (pool: Pool, token: string, filters: { status?: string; search?: string } = {}) =>
  anon<{ total: number; rows: LeadRow[] }>(pool, "select lh_list_leads($1, null, $2, null, $3) as r", [
    token,
    filters.status ?? null,
    filters.search ?? null,
  ]);

export const uniqueSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
