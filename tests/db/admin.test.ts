import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, listLeads, setupAdmin, uniqueSlug } from "./harness";

interface Summary {
  id: string;
  name: string;
  slug: string;
  leads_total: number;
  pages: { id: string; public_key: string; domains: string[]; whatsapp_code: boolean }[];
}

describe("admin panel", () => {
  let pool: Pool;
  let admin: { login: string; password: string; token: string };

  beforeAll(async () => {
    pool = createPool();
    admin = await setupAdmin(pool);
  });

  afterAll(() => pool.end());

  const createClient = async (name = "Clínica Teste") => {
    const slug = uniqueSlug("cli");
    const result = await anon<{ workspace: Summary; password: string }>(
      pool,
      "select lh_admin_create_workspace($1, $2, $3, $4, $5) as r",
      [admin.token, name, slug, "LP principal", ["clinica.com.br"]],
    );
    return { ...result, slug };
  };

  it("logs in only with the right password", async () => {
    expect(await anon(pool, "select lh_admin_login($1, $2) as r", [admin.login, "errada"])).toBeNull();
    expect(await anon(pool, "select lh_admin_login($1, $2) as r", [admin.login.toUpperCase(), admin.password])).not.toBeNull();
  });

  it("creates a client with a landing page and an attendant password", async () => {
    const { workspace, password, slug } = await createClient();
    expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(workspace).toMatchObject({ slug, leads_total: 0 });
    expect(workspace.pages).toHaveLength(1);
    expect(workspace.pages[0]).toMatchObject({ domains: ["clinica.com.br"], whatsapp_code: true });
    expect(workspace.pages[0].public_key).toMatch(/^pk_[0-9a-f]{32}$/);

    const session = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [slug, password]);
    const info = await anon<{ role: string }>(pool, "select lh_session($1) as r", [session.token]);
    expect(info.role).toBe("atendente");
  });

  it("resets the password and signs out attendants using the old one", async () => {
    const { workspace, password, slug } = await createClient();
    const old = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [slug, password]);
    const fresh = await anon<string>(pool, "select lh_admin_reset_password($1, $2) as r", [admin.token, workspace.id]);

    expect(fresh).not.toBe(password);
    expect(await anon(pool, "select lh_session($1) as r", [old.token])).toBeNull();
    expect(await anon(pool, "select lh_login($1, $2) as r", [slug, password])).toBeNull();
    expect(await anon(pool, "select lh_login($1, $2) as r", [slug, fresh])).not.toBeNull();
  });

  it("opens a client's sheet as admin", async () => {
    const { workspace } = await createClient();
    await collect(pool, workspace.pages[0].public_key, { type: "whatsapp_click", visitor_id: "adm-1" }, "clinica.com.br");
    const opened = await anon<{ token: string; slug: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [
      admin.token,
      workspace.id,
    ]);
    expect(opened.slug).toBe(workspace.slug);
    expect((await anon<{ role: string }>(pool, "select lh_session($1) as r", [opened.token])).role).toBe("admin");
    expect((await listLeads(pool, opened.token)).total).toBe(1);
  });

  it("lists clients with their numbers and manages landing pages", async () => {
    const { workspace } = await createClient("Cliente com LP extra");
    const page = await anon<{ id: string; name: string }>(pool, "select lh_admin_add_page($1, $2, $3, $4) as r", [
      admin.token,
      workspace.id,
      "LP Black Friday",
      [],
    ]);
    await anon(pool, "select lh_admin_update_page($1, $2, $3, $4, $5) as r", [admin.token, page.id, "LP BF", ["bf.com.br"], false]);

    const list = await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [admin.token]);
    const mine = list.find((w) => w.id === workspace.id)!;
    expect(mine.pages.map((p) => p.domains)).toEqual([["clinica.com.br"], ["bf.com.br"]]);
    expect(mine.pages[1].whatsapp_code).toBe(false);
  });

  it("refuses every admin function without a valid admin session", async () => {
    const client = await anon<{ token: string } | null>(pool, "select lh_login('x', 'y') as r");
    expect(client).toBeNull();
    for (const [sql, params] of [
      ["select lh_admin_list_workspaces($1) as r", ["nope"]],
      ["select lh_admin_create_workspace($1, 'x', 'x-slug', 'lp', '{}') as r", [""]],
      ["select lh_admin_reset_password($1, gen_random_uuid()) as r", [null]],
      ["select lh_admin_open_workspace($1, gen_random_uuid()) as r", ["0".repeat(64)]],
    ] as const) {
      await expect(anon(pool, sql, [...params])).rejects.toMatchObject({ code: "LH401" });
    }
  });

  it("does not accept a client session as admin", async () => {
    const { password, slug } = await createClient();
    const session = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [slug, password]);
    await expect(anon(pool, "select lh_admin_list_workspaces($1) as r", [session.token])).rejects.toMatchObject({
      code: "LH401",
    });
  });

  it("keeps admin tables away from API roles", async () => {
    for (const table of ["lh_admins", "lh_admin_sessions"]) {
      await expect(anon(pool, `select * from ${table}`)).rejects.toThrow(/permission denied/);
    }
  });

  it("lets only admin sessions delete rows, together with their events", async () => {
    const { workspace, password, slug } = await createClient();
    const key = workspace.pages[0].public_key;
    await collect(pool, key, { type: "page_view", visitor_id: "del-1" }, "clinica.com.br");
    const test = await collect(pool, key, { type: "whatsapp_click", visitor_id: "del-1" }, "clinica.com.br");
    const real = await collect(pool, key, { type: "whatsapp_click", visitor_id: "del-2" }, "clinica.com.br");

    const attendant = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [slug, password]);
    await expect(
      anon(pool, "select lh_delete_leads($1, $2) as r", [attendant.token, [test.lead_id]]),
    ).rejects.toMatchObject({ code: "LH403" });

    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, workspace.id]);
    expect(await anon(pool, "select lh_delete_leads($1, $2) as r", [opened.token, [test.lead_id]])).toBe(1);

    const left = await listLeads(pool, opened.token);
    expect(left.rows.map((r) => r.id)).toEqual([real.lead_id]);
    const stats = await anon<{ visitors: number; clicks: number }>(pool, "select lh_stats($1) as r", [opened.token]);
    expect(stats).toMatchObject({ visitors: 0, clicks: 1 });
  });

  it("does not delete another client's rows", async () => {
    const a = await createClient();
    const b = await createClient();
    const other = await collect(pool, b.workspace.pages[0].public_key, { type: "whatsapp_click", visitor_id: "x" }, "clinica.com.br");
    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, a.workspace.id]);
    expect(await anon(pool, "select lh_delete_leads($1, $2) as r", [opened.token, [other.lead_id]])).toBe(0);
  });
});
