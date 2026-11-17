import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

type Alert = { workspace_id: string; page_id: string; host: string; events: number; leads: number };

describe("alerts for sends from an address that is not among the page's domains", () => {
  let pool: Pool;
  let master: { token: string };
  let client: Setup;
  const note = (host: string, lead: boolean, key = client.key) =>
    anon(pool, "select lh_server_note_refused_origin($1, $2, $3, $4) is null as r", [SERVER_SECRET, key, host, lead]);
  const alerts = (token = master.token) =>
    anon<Alert[]>(pool, "select lh_admin_origin_alerts($1) as r", [token]).then((all) => all.filter((a) => a.workspace_id === client.workspaceId));

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    client = await setupWorkspace(pool, "Cliente Domínio");
    await pool.query("update lh_pages set domains = '{clinica.com.br}' where id = $1", [client.pageId]);
  });
  afterAll(() => pool.end());

  it("the refused send itself still fails; the app records the address and counts lost contacts", async () => {
    await expect(collect(pool, client.key, { type: "whatsapp_click", visitor_id: randomUUID() }, "novosite.com.br")).rejects.toMatchObject({
      code: "LH403",
    });
    await note("novosite.com.br", false);
    await note("novosite.com.br", true);
    await note("NovoSite.com.br", true);
    expect(await alerts()).toEqual([expect.objectContaining({ page_id: client.pageId, host: "novosite.com.br", events: 3, leads: 2 })]);
  });

  it("ignores junk, local addresses, allowed ones and unknown pages; needs the server secret", async () => {
    for (const host of ["localhost", "127.0.0.1", "x", "a b.com", "clinica.com.br"]) await note(host, true);
    await note("outro.com.br", true, "pk_desconhecida");
    expect((await alerts()).map((a) => a.host)).toEqual(["novosite.com.br"]);
    await expect(anon(pool, "select lh_server_note_refused_origin('errado', $1, 'a.com.br', true) as r", [client.key])).rejects.toMatchObject({
      code: "LH401",
    });
    await expect(anon(pool, "select count(*) as r from lh_origin_alerts")).rejects.toMatchObject({ code: "42501" });
  });

  it("allowing adds the address to the page and the next send goes through", async () => {
    await anon(pool, "select lh_admin_allow_origin($1, $2, 'novosite.com.br') is null as r", [master.token, client.pageId]);
    const { rows } = await pool.query("select domains from lh_pages where id = $1", [client.pageId]);
    expect(rows[0].domains).toEqual(["clinica.com.br", "novosite.com.br"]);
    expect(await alerts()).toEqual([]);
    await collect(pool, client.key, { type: "whatsapp_click", visitor_id: randomUUID() }, "novosite.com.br");
    // Only addresses that were actually refused can be allowed this way.
    await expect(
      anon(pool, "select lh_admin_allow_origin($1, $2, 'qualquer.com') as r", [master.token, client.pageId]),
    ).rejects.toMatchObject({ code: "LH404" });
  });

  it("dismissing hides it until another contact is refused", async () => {
    await note("estranho.com", false);
    await anon(pool, "select lh_admin_dismiss_origin($1, $2, 'estranho.com') is null as r", [master.token, client.pageId]);
    await note("estranho.com", false);
    expect(await alerts()).toEqual([]);
    await note("estranho.com", true);
    expect((await alerts()).map((a) => a.host)).toEqual(["estranho.com"]);
  });

  it("stops recording new addresses after 10 per page", async () => {
    for (let i = 0; i < 15; i++) await note(`spam${i}.com`, false);
    const { rows } = await pool.query("select count(*)::int n from lh_origin_alerts where page_id = $1", [client.pageId]);
    expect(rows[0].n).toBe(10);
  });

  it("a gestor sees only the alerts of their own clients", async () => {
    const g = await anon<{ login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      master.token,
      `g-${randomUUID().slice(0, 8)}@example.com`,
    ]);
    const token = (await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [g.login, g.password])).token;
    expect(await alerts(token)).toEqual([]);
    await expect(anon(pool, "select lh_admin_dismiss_origin($1, $2, 'estranho.com') as r", [token, client.pageId])).rejects.toMatchObject({
      code: "LH404",
    });
  });
});
