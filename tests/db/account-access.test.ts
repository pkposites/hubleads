import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, setupAdmin } from "./harness";

interface Summary {
  id: string;
  pages: { id: string }[];
}

describe("people of a client (role 'conta')", () => {
  let pool: Pool;
  let master: { token: string };
  let gestor: { id: string; login: string; token: string };
  let theirs: Summary;
  let other: Summary;
  let gestorOther: Summary;
  let person: { id: string; login: string; password: string; token: string };

  const login = async (l: string, p: string) =>
    (await anon<{ token: string } | null>(pool, "select lh_admin_login($1, $2) as r", [l, p]))?.token ?? null;
  const createClient = (t: string, name: string) =>
    anon<{ workspace: Summary }>(pool, "select lh_admin_create_workspace($1, $2, $3, 'LP', '{}') as r", [
      t,
      name,
      `cli-${randomUUID().slice(0, 8)}`,
    ]).then((r) => r.workspace);
  const ids = (list: { id: string }[]) => list.map((c) => c.id).sort();

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    const g = await anon<{ id: string; login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      master.token,
      `gestor-${randomUUID().slice(0, 8)}@agencia.com`,
    ]);
    gestor = { ...g, token: (await login(g.login, g.password))! };
    theirs = await createClient(master.token, "Loja do cliente");
    other = await createClient(master.token, "Outro cliente do master");
    gestorOther = await createClient(gestor.token, "Cliente do gestor");
    const added = await anon<{ id: string; login: string; password: string }>(pool, "select lh_admin_add_member($1, $2, $3) as r", [
      master.token,
      theirs.id,
      `pessoa-${randomUUID().slice(0, 8)}@loja.com`,
    ]);
    person = { ...added, token: (await login(added.login, added.password))! };
  });
  afterAll(() => pool.end());

  it("sees only the client they were given, in every list", async () => {
    expect(await anon(pool, "select lh_admin_session($1) as r", [person.token])).toMatchObject({ role: "conta" });
    expect(ids(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [person.token]))).toEqual([theirs.id]);
    const all = await anon<{ by_client: { id: string }[] }>(pool, "select lh_admin_all_leads($1, '{}') as r", [person.token]);
    expect(all.by_client.every((c) => c.id === theirs.id)).toBe(true);
    const filtered = await anon<{ total: number }>(pool, "select lh_admin_all_leads($1, $2) as r", [
      person.token,
      JSON.stringify({ client: other.id }),
    ]);
    expect(filtered.total).toBe(0);
  });

  it("EVERY admin function that takes a client refuses the clients they were not given", async () => {
    const { rows } = await pool.query(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'lh\\_admin\\_%'
        and pg_get_function_identity_arguments(p.oid) ~ '(p_workspace_id|p_page_id) uuid'`);
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const target of [other, gestorOther]) {
      const page = (await pool.query("select id from lh_pages where workspace_id = $1", [target.id])).rows[0].id;
      for (const { proname, args } of rows as { proname: string; args: string }[]) {
        const params = args.split(",").map((a) => a.trim().split(" "));
        const values = params.map(([name, type]) => {
          if (name === "p_token") return person.token;
          if (name === "p_workspace_id") return target.id;
          if (name === "p_page_id") return page;
          if (type === "boolean") return true;
          if (type === "integer") return 10;
          if (type === "bigint") return Math.floor(Date.now() / 1000);
          if (type === "uuid") return "00000000-0000-4000-8000-000000000000";
          if (type === "text[]") return [];
          if (type === "jsonb") return "{}";
          return "x@y.com";
        });
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        // transfer and delete are master only: refused either way.
        await expect(
          anon(pool, `select ${proname}(${placeholders}) as r`, values),
          `${proname} deixou a pessoa da conta acessar outro cliente`,
        ).rejects.toMatchObject({ code: expect.stringMatching(/^LH40[34]$/) });
      }
    }
  });

  it("manages their own client but cannot create clients nor give access", async () => {
    expect(await anon(pool, "select lh_admin_workspace($1, $2) as r", [person.token, theirs.id])).toMatchObject({ id: theirs.id });
    expect(await anon<string>(pool, "select lh_admin_reset_password($1, $2) as r", [person.token, theirs.id])).toMatch(/-/);
    await expect(createClient(person.token, "Novo")).rejects.toMatchObject({ code: "LH403" });
    await expect(
      anon(pool, "select lh_admin_add_member($1, $2, 'amigo@loja.com') as r", [person.token, theirs.id]),
    ).rejects.toMatchObject({ code: "LH403" });
    await expect(anon(pool, "select lh_admin_list_members($1, $2) as r", [person.token, theirs.id])).rejects.toMatchObject({
      code: "LH403",
    });
    for (const fn of ["lh_admin_list_admins", "lh_admin_infra", "lh_admin_list_signups"]) {
      await expect(anon(pool, `select ${fn}($1) as r`, [person.token])).rejects.toMatchObject({ code: "LH403" });
    }
  });

  it("the owner gestor gives access to their client, never with someone else's e-mail", async () => {
    await expect(
      anon(pool, "select lh_admin_add_member($1, $2, $3) as r", [gestor.token, gestorOther.id, gestor.login]),
    ).rejects.toMatchObject({ code: "LH409" });
    await expect(
      anon(pool, "select lh_admin_add_member($1, $2, 'x@y.com') as r", [gestor.token, theirs.id]),
    ).rejects.toMatchObject({ code: "LH404" });
    // The same person gains a second client without a new password.
    const again = await anon<{ password?: string }>(pool, "select lh_admin_add_member($1, $2, $3) as r", [
      gestor.token,
      gestorOther.id,
      person.login,
    ]);
    expect(again.password).toBeUndefined();
    expect(ids(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [person.token]))).toEqual(
      [theirs.id, gestorOther.id].sort(),
    );
    const members = await anon<{ id: string; login: string }[]>(pool, "select lh_admin_list_members($1, $2) as r", [
      gestor.token,
      gestorOther.id,
    ]);
    expect(members.map((m) => m.login)).toEqual([person.login]);
  });

  it("removing access takes effect at once; the last one disables the account", async () => {
    await anon(pool, "select lh_admin_remove_member($1, $2, $3) as r", [gestor.token, gestorOther.id, person.id]);
    expect(ids(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [person.token]))).toEqual([theirs.id]);
    await expect(anon(pool, "select lh_admin_workspace($1, $2) as r", [person.token, gestorOther.id])).rejects.toMatchObject({
      code: "LH404",
    });
    await anon(pool, "select lh_admin_remove_member($1, $2, $3) as r", [master.token, theirs.id, person.id]);
    await expect(anon(pool, "select lh_admin_list_workspaces($1) as r", [person.token])).rejects.toMatchObject({ code: "LH401" });
    expect(await login(person.login, person.password)).toBeNull();
    // Giving access again creates a new password.
    const back = await anon<{ password?: string }>(pool, "select lh_admin_add_member($1, $2, $3) as r", [
      master.token,
      theirs.id,
      person.login,
    ]);
    expect(back.password).toBeTruthy();
    expect(await login(person.login, back.password!)).toBeTruthy();
  });
});
