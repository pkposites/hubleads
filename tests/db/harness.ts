import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { inject } from "vitest";

export type Db = PoolClient;

export function createPool() {
  return new Pool({ connectionString: inject("dbUrl"), max: 4 });
}

type Role = "authenticated" | "anon" | "service_role";

async function asRole<T>(pool: Pool, role: Role, sub: string | null, fn: (db: Db) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

/** Runs `fn` in a transaction as a signed-in user, with RLS applied. */
export const asUser = <T>(pool: Pool, userId: string, fn: (db: Db) => Promise<T>) =>
  asRole(pool, "authenticated", userId, fn);

export const asAnon = <T>(pool: Pool, fn: (db: Db) => Promise<T>) => asRole(pool, "anon", null, fn);

/** The server-side service role used by the ingestion API. */
export const asService = <T>(pool: Pool, fn: (db: Db) => Promise<T>) =>
  asRole(pool, "service_role", null, fn);

export async function createUser(pool: Pool, label = "user") {
  const email = `${label}-${randomUUID()}@example.com`;
  const { rows } = await pool.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: label })],
  );
  return rows[0].id;
}

export const uniqueSlug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export async function createWorkspace(pool: Pool, adminId: string, name = "Workspace") {
  return asUser(pool, adminId, async (db) => {
    const { rows } = await db.query<{ id: string; slug: string }>(
      "select id, slug from leadhub.create_workspace($1, $2)",
      [name, uniqueSlug("ws")],
    );
    return rows[0];
  });
}

export async function addMember(pool: Pool, adminId: string, workspaceId: string, userId: string, role: string) {
  await asUser(pool, adminId, (db) =>
    db.query("insert into leadhub.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)", [
      workspaceId,
      userId,
      role,
    ]),
  );
}

export async function createProject(pool: Pool, userId: string, workspaceId: string, name = "Projeto") {
  return asUser(pool, userId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "insert into leadhub.projects (workspace_id, name, slug) values ($1, $2, $3) returning id",
      [workspaceId, name, uniqueSlug("prj")],
    );
    return rows[0].id;
  });
}

export interface IngestInput {
  project_id: string;
  idempotency_key?: string;
  request_hash?: string;
  lead: { name?: string; phone?: string; phone_norm?: string; email?: string; email_norm?: string };
  answers?: Record<string, string>;
  touch?: Record<string, unknown>;
  first_touch?: Record<string, unknown>;
  tracking?: Record<string, unknown>;
  consent?: Record<string, unknown>;
  form_id?: string;
}

export interface IngestResult {
  lead_id: string;
  conversion_id: string;
  created: boolean;
  duplicate: boolean;
  replayed: boolean;
  received_at: string;
}

export async function ingest(pool: Pool, input: IngestInput) {
  return asService(pool, async (db) => {
    const { rows } = await db.query<{ r: IngestResult }>("select leadhub.ingest_lead_conversion($1) as r", [
      JSON.stringify(input),
    ]);
    return rows[0].r;
  });
}

export async function stagesOf(pool: Pool, userId: string, projectId: string) {
  return asUser(pool, userId, async (db) => {
    const { rows } = await db.query<{ id: string; key: string; kind: string }>(
      "select id, key, kind from leadhub.pipeline_stages where project_id = $1 order by position",
      [projectId],
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
  });
}
