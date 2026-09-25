import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, setupAdmin, setupWorkspace } from "./harness";

interface Summary {
  id: string;
  slug: string;
  owner_login: string | null;
  pages: { id: string }[];
}

describe("separate panels for gestores", () => {
  let pool: Pool;
  let master: { token: string; login: string };
  let gestor: { id: string; login: string; password: string; token: string };
  let other: { id: string; login: string; password: string; token: string };
  let mine: Summary;
  let masters: Summary;

  const login = async (l: string, p: string) =>
    (await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [l, p])).token;
  const createGestor = async (t: string) => {
    const g = await anon<{ id: string; login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      t,
      `gestor-${randomUUID().slice(0, 8)}@agencia.com`,
    ]);
    return { ...g, token: await login(g.login, g.password) };
  };
  const createClient = (t: string, name: string) =>
    anon<{ workspace: Summary }>(pool, "select lh_admin_create_workspace($1, $2, $3, 'LP', '{}') as r", [
      t,
      name,
      `cli-${randomUUID().slice(0, 8)}`,
    ]).then((r) => r.workspace);

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    gestor = await createGestor(master.token);
    other = await createGestor(master.token);
    mine = await createClient(gestor.token, "Cliente do gestor");
    masters = await createClient(master.token, "Cliente do master");
  });
  afterAll(() => pool.end());

  it("admins created from SQL are masters; gestores come from the panel", async () => {
    expect(await anon(pool, "select lh_admin_session($1) as r", [master.token])).toMatchObject({ role: "master" });
    expect(await anon(pool, "select lh_admin_session($1) as r", [gestor.token])).toMatchObject({ role: "gestor" });
    await expect(anon(pool, "select lh_admin_create_gestor($1, 'x@y.com') as r", [gestor.token])).rejects.toMatchObject({ code: "LH403" });
    await expect(anon(pool, "select lh_admin_list_admins($1) as r", [gestor.token])).rejects.toMatchObject({ code: "LH403" });
    await expect(anon(pool, "select lh_admin_infra($1) as r", [gestor.token])).rejects.toMatchObject({ code: "LH403" });
  });

  it("a gestor lists only their clients; the master lists all, with the owner", async () => {
    const list = await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [gestor.token]);
    expect(list.map((c) => c.id)).toEqual([mine.id]);
    expect(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [other.token])).toEqual([]);
    const all = await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [master.token]);
    expect(all.find((c) => c.id === mine.id)?.owner_login).toBe(gestor.login);
    expect(all.map((c) => c.id)).toContain(masters.id);
  });

  it("EVERY admin function that takes a client refuses someone else's client", async () => {
    // Clients created from SQL (no owner) belong to the master only.
    const legacy = await setupWorkspace(pool, "Cliente antigo");
    const { rows } = await pool.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'lh\\_admin\\_%'
        and pg_get_function_identity_arguments(p.oid) ~ '(p_workspace_id|p_page_id) uuid'`);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const page = (await pool.query("select id from lh_pages where workspace_id = $1", [masters.id])).rows[0].id;
    for (const { proname, args } of rows as { proname: string; args: string }[]) {
      if (proname === "lh_admin_transfer_workspace") continue; // master only, tested below
      const params = args.split(",").map((a) => a.trim().split(" "));
      const values = params.map(([name, type]) => {
        if (name === "p_token") return gestor.token;
        if (name === "p_workspace_id") return masters.id;
        if (name === "p_page_id") return page;
        if (type === "boolean") return true;
        if (type === "integer") return 10;
        if (type === "text[]") return [];
        return "x";
      });
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
      await expect(
        anon(pool, `select ${proname}(${placeholders}) as r`, values),
        `${proname} deixou o gestor acessar cliente de outro`,
      ).rejects.toMatchObject({ code: "LH404" });
    }
    await expect(anon(pool, "select lh_admin_workspace($1, $2) as r", [gestor.token, legacy.workspaceId])).rejects.toMatchObject({
      code: "LH404",
    });
    expect(await anon(pool, "select lh_admin_workspace($1, $2) as r", [master.token, legacy.workspaceId])).toMatchObject({
      id: legacy.workspaceId,
    });
  });

  it("a gestor fully manages their own client", async () => {
    expect(await anon(pool, "select lh_admin_workspace($1, $2) as r", [gestor.token, mine.id])).toMatchObject({ id: mine.id });
    expect(await anon<string>(pool, "select lh_admin_reset_password($1, $2) as r", [gestor.token, mine.id])).toMatch(/-/);
    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [gestor.token, mine.id]);
    expect(await anon(pool, "select lh_session($1) as r", [opened.token])).toMatchObject({ role: "admin" });
  });

  it("the master hands a client over; the old owner loses it, including open sheets", async () => {
    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [gestor.token, mine.id]);
    await expect(
      anon(pool, "select lh_admin_transfer_workspace($1, $2, $3) as r", [gestor.token, mine.id, other.id]),
    ).rejects.toMatchObject({ code: "LH403" });
    await anon(pool, "select lh_admin_transfer_workspace($1, $2, $3) as r", [master.token, mine.id, other.id]);
    expect(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [gestor.token])).toEqual([]);
    expect((await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [other.token])).map((c) => c.id)).toEqual([mine.id]);
    expect(await anon(pool, "select lh_session($1) as r", [opened.token])).toBeNull();
  });

  it("deactivating a gestor logs them out for good; resetting brings them back", async () => {
    const g = await createGestor(master.token);
    await anon(pool, "select lh_admin_deactivate_gestor($1, $2) as r", [master.token, g.id]);
    await expect(anon(pool, "select lh_admin_list_workspaces($1) as r", [g.token])).rejects.toMatchObject({ code: "LH401" });
    expect(await anon(pool, "select lh_admin_login($1, $2) as r", [g.login, g.password])).toBeNull();
    const fresh = await anon<string>(pool, "select lh_admin_reset_admin_password($1, $2) as r", [master.token, g.id]);
    expect(await login(g.login, fresh)).toBeTruthy();
    const list = await anon<{ id: string; active: boolean; role: string }[]>(pool, "select lh_admin_list_admins($1) as r", [master.token]);
    expect(list.find((a) => a.id === g.id)).toMatchObject({ active: true, role: "gestor" });
    // The master cannot be deactivated from the panel.
    const masterId = list.find((a) => a.role === "master")!.id;
    await expect(anon(pool, "select lh_admin_deactivate_gestor($1, $2) as r", [master.token, masterId])).rejects.toMatchObject({
      code: "LH404",
    });
  });
});
