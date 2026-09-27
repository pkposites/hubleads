import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin } from "./harness";

interface Created {
  workspace: { id: string; name: string; pages: { id: string; public_key: string }[] };
}

describe("deleting a client", () => {
  let pool: Pool;
  let master: { token: string; login: string };

  const create = (token: string, name: string) =>
    anon<Created>(pool, "select lh_admin_create_workspace($1, $2, $3, 'LP', '{}') as r", [token, name, `del-${randomUUID().slice(0, 8)}`]).then(
      (r) => r.workspace,
    );
  const remove = (token: string, id: string, name: string) =>
    anon<{ leads: number }>(pool, "select lh_admin_delete_workspace($1, $2, $3) as r", [token, id, name]);
  const count = async (table: string, id: string) =>
    (await pool.query(`select count(*)::int n from ${table} where workspace_id = $1`, [id])).rows[0].n as number;

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
  });
  afterAll(() => pool.end());

  it("asks for the exact name, then deletes everything of the client and keeps an audit entry", async () => {
    const ws = await create(master.token, "Clínica Apagar");
    const key = ws.pages[0].public_key;
    await collect(pool, key, { type: "page_view", visitor_id: "vis1234567" });
    await collect(pool, key, { type: "whatsapp_click", visitor_id: "vis1234567", name: "Ana" });
    expect(await count("lh_leads", ws.id)).toBe(1);

    await expect(remove(master.token, ws.id, "Clinica errada")).rejects.toMatchObject({ code: "22023" });
    expect(await count("lh_leads", ws.id)).toBe(1);

    expect(await remove(master.token, ws.id, "  clínica apagar ")).toEqual({ leads: 1 });
    for (const table of ["lh_pages", "lh_leads", "lh_events"]) expect(await count(table, ws.id)).toBe(0);
    expect((await pool.query("select count(*)::int n from lh_workspaces where id = $1", [ws.id])).rows[0].n).toBe(0);
    const audit = await pool.query("select action, detail from lh_audit where workspace_id = $1 and action = 'delete_workspace'", [ws.id]);
    expect(audit.rows).toEqual([{ action: "delete_workspace", detail: expect.objectContaining({ leads: 1, by: master.login }) }]);
    expect(JSON.stringify(audit.rows)).not.toContain("Ana");

    // The page key stops working.
    await expect(collect(pool, key, { type: "page_view", visitor_id: "vis7654321" })).rejects.toMatchObject({ code: "LH401" });
  });

  it("only the master can delete; a gestor gets 'not found' for other clients and 'forbidden' for their own", async () => {
    const gestor = await anon<{ login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      master.token,
      `g-${randomUUID().slice(0, 8)}@agencia.com`,
    ]);
    const token = (await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [gestor.login, gestor.password])).token;
    const own = await create(token, "Cliente do gestor");
    const masters = await create(master.token, "Cliente do master");

    await expect(remove(token, masters.id, "Cliente do master")).rejects.toMatchObject({ code: "LH404" });
    await expect(remove(token, own.id, "Cliente do gestor")).rejects.toMatchObject({ code: "LH403" });
    expect((await pool.query("select count(*)::int n from lh_workspaces where id in ($1, $2)", [own.id, masters.id])).rows[0].n).toBe(2);
    await expect(remove("token-invalido", masters.id, "Cliente do master")).rejects.toMatchObject({ code: "LH401" });
  });
});
