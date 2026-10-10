import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace, uniqueSlug, type Setup } from "./harness";

type AllLeads = { total: number; by_client: { id: string; count: number }[]; leads: { client_id: string; name: string; phone: string }[] };

describe("all leads of the admin's clients (painel mãe)", () => {
  let pool: Pool;
  let master: { token: string };
  let a: Setup;
  let b: Setup;

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    a = await setupWorkspace(pool, "Todos A");
    b = await setupWorkspace(pool, "Todos B");
    await collect(pool, a.key, { type: "whatsapp_click", visitor_id: "all-a1", name: "Ana Todos", phone: "+5511911112222" });
    await collect(pool, a.key, { type: "whatsapp_click", visitor_id: "all-a2", name: "Bruno Todos" });
    await collect(pool, b.key, { type: "whatsapp_click", visitor_id: "all-b1", name: "Carla Todos" });
  });
  afterAll(() => pool.end());

  const list = (token: string, filters: Record<string, unknown> = {}) =>
    anon<AllLeads>(pool, "select lh_admin_all_leads($1, $2) as r", [token, JSON.stringify(filters)]);

  it("the master sees the leads of every client, newest first, and filters them", async () => {
    const all = await list(master.token, { search: "Todos" });
    expect(all.leads.map((l) => l.name)).toEqual(["Carla Todos", "Bruno Todos", "Ana Todos"]);
    expect(all.by_client).toEqual(expect.arrayContaining([{ id: a.workspaceId, name: "Todos A", count: 2 }]));
    expect((await list(master.token, { client: b.workspaceId, search: "Todos" })).leads.map((l) => l.name)).toEqual(["Carla Todos"]);
    expect((await list(master.token, { search: "1111-2222" })).leads.map((l) => l.name)).toEqual(["Ana Todos"]);
    expect((await list(master.token, { search: "Todos", limit: 1 })).leads).toHaveLength(1);
    expect((await list(master.token, { search: "Todos", status: "venda" })).total).toBe(0);
  });

  it("a gestor sees only the clients they own", async () => {
    const created = await anon<{ login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [master.token, `${uniqueSlug("g")}@x.com`]);
    const gestor = await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [created.login, created.password]);
    expect((await list(gestor.token, { search: "Todos" })).total).toBe(0);
    await pool.query("update lh_workspaces set owner_admin_id = (select admin_id from lh_admin_sessions where token_hash = lh_private.sha256($1)) where id = $2", [gestor.token, a.workspaceId]);
    const mine = await list(gestor.token, { search: "Todos" });
    expect(mine.leads.every((l) => l.client_id === a.workspaceId)).toBe(true);
    expect(mine.total).toBe(2);
    expect((await list(gestor.token, { client: b.workspaceId })).total).toBe(0);
  });

  it("needs an admin session", async () => {
    await expect(list(a.token)).rejects.toMatchObject({ code: "LH401" });
    await expect(list(master.token, { client: "x" })).rejects.toMatchObject({ code: "22023" });
  });
});
