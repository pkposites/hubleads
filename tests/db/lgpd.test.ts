import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace } from "./harness";

const SECRET = "test-server-secret-0123456789abcdef";

describe("login limits", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = createPool();
  });
  afterAll(() => pool.end());

  const login = (slug: string, password: string, client = "ip-a") =>
    anon<{ token?: string; locked?: boolean; retry_after?: number } | null>(pool, "select lh_login($1, $2, $3) as r", [
      slug,
      password,
      client,
    ]);

  it("locks a device after 5 wrong passwords, without locking other devices", async () => {
    const ws = await setupWorkspace(pool, "Bloqueio");
    for (let i = 0; i < 5; i++) expect(await login(ws.slug, "errada")).toBeNull();
    const locked = await login(ws.slug, ws.password);
    expect(locked).toMatchObject({ locked: true });
    expect(locked!.retry_after).toBeGreaterThan(800);
    expect(await login(ws.slug, ws.password, "ip-b")).toMatchObject({ token: expect.any(String) });
  });

  it("locks the account for everyone after 30 failures, and a right password clears the count", async () => {
    const ws = await setupWorkspace(pool, "Ataque distribuído");
    for (let i = 0; i < 4; i++) await login(ws.slug, "errada", "ip-x");
    expect(await login(ws.slug, ws.password, "ip-x")).toMatchObject({ token: expect.any(String) });
    expect(await login(ws.slug, "errada", "ip-x")).toBeNull(); // count restarted

    for (let i = 0; i < 30; i++) await pool.query("select lh_private.login_failed($1, $2)", [`ws:${ws.slug}`, `bot-${i}`]);
    expect(await login(ws.slug, ws.password, "ip-new")).toMatchObject({ locked: true });
  });

  it("answers the same for accounts that do not exist", async () => {
    for (let i = 0; i < 5; i++) expect(await login("nao-existe", "x")).toBeNull();
    expect(await login("nao-existe", "x")).toMatchObject({ locked: true });
  });

  it("limits the admin login too", async () => {
    const admin = await setupAdmin(pool);
    for (let i = 0; i < 5; i++) {
      expect(await anon(pool, "select lh_admin_login($1, $2, 'ip-a') as r", [admin.login, "errada"])).toBeNull();
    }
    expect(await anon(pool, "select lh_admin_login($1, $2, 'ip-a') as r", [admin.login, admin.password])).toMatchObject({
      locked: true,
    });
  });
});

describe("LGPD", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = createPool();
    await pool.query("select lh_private.set_server_secret($1)", [SECRET]);
  });
  afterAll(() => pool.end());

  it("records whether the visitor accepted tracking", async () => {
    const ws = await setupWorkspace(pool, "Consentimento");
    const refused = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "c-no", consent: false })).lead_id;
    const accepted = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "c-yes", consent: true })).lead_id;
    const legacy = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "c-old" })).lead_id;
    const { rows } = await pool.query("select id, tracking_consent from lh_leads where id = any($1)", [[refused, accepted, legacy]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.tracking_consent]));
    expect(byId).toEqual({ [refused!]: false, [accepted!]: true, [legacy!]: null });
  });

  it("publishes the privacy details, by slug or page key", async () => {
    const admin = await setupAdmin(pool);
    const ws = await setupWorkspace(pool, "Clínica Privada");
    await anon(pool, "select lh_admin_set_privacy($1, $2, $3, $4, $5, 12) as r", [
      admin.token,
      ws.workspaceId,
      "Clínica Privada Ltda",
      "12.345.678/0001-90",
      "Privacidade@Clinica.com.br",
    ]);
    const bySlug = await anon<Record<string, unknown>>(pool, "select lh_public_privacy($1) as r", [ws.slug]);
    expect(bySlug).toMatchObject({
      controller: "Clínica Privada Ltda",
      email: "privacidade@clinica.com.br",
      retention_months: 12,
      meta: false,
    });
    expect(await anon(pool, "select lh_public_privacy($1) as r", [ws.key])).toEqual(bySlug);
    expect(await anon(pool, "select lh_public_privacy('nao-existe') as r")).toBeNull();
    await expect(
      anon(pool, "select lh_admin_set_privacy($1, $2, 'X', null, 'sem-arroba', 12) as r", [admin.token, ws.workspaceId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(anon(pool, "select lh_admin_get_privacy($1, $2) as r", [ws.token, ws.workspaceId])).rejects.toBeTruthy();
  });

  it("exports one lead's data for the person (admin only) and records it", async () => {
    const admin = await setupAdmin(pool);
    const ws = await setupWorkspace(pool, "Exportação");
    await collect(pool, ws.key, { type: "page_view", visitor_id: "x-1" });
    const lead = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "x-1", name: "Rita", ip_address: "1.2.3.4" })).lead_id!;
    await expect(anon(pool, "select lh_lead_export($1, $2) as r", [ws.token, lead])).rejects.toMatchObject({ code: "LH403" });
    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, ws.workspaceId]);
    const data = await anon<{ lead: Record<string, unknown>; page_events: unknown[]; history: unknown[] }>(
      pool,
      "select lh_lead_export($1, $2) as r",
      [opened.token, lead],
    );
    expect(data.lead).toMatchObject({ name: "Rita", ip_address: "1.2.3.4" });
    expect(data.page_events).toHaveLength(2);
    expect(data.history.length).toBeGreaterThan(0);

    await anon(pool, "select lh_log_export($1, 12, '{}') as r", [ws.token]);
    await anon(pool, "select lh_delete_leads($1, $2) as r", [opened.token, [lead]]);
    const audit = await anon<{ audit: { action: string; actor: string; detail: Record<string, unknown> }[] }>(
      pool,
      "select lh_admin_get_privacy($1, $2) as r",
      [admin.token, ws.workspaceId],
    );
    expect(audit.audit.map((a) => [a.action, a.actor])).toEqual([
      ["delete_leads", "admin"],
      ["export_csv", "atendente"],
      ["export_lead", "admin"],
    ]);
    expect(audit.audit[0].detail).toEqual({ count: 1 });
  });

  it("deletes old data by the client's retention and clears IP after 90 days", async () => {
    const ws = await setupWorkspace(pool, "Retenção");
    const old = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "r-old" })).lead_id!;
    const recent = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "r-new", ip_address: "9.9.9.9", user_agent: "UA" })).lead_id!;
    await pool.query("update lh_workspaces set retention_months = 6 where id = $1", [ws.workspaceId]);
    await pool.query(
      "update lh_leads set created_at = now() - interval '7 months', last_click_at = now() - interval '7 months', updated_at = now() - interval '7 months' where id = $1",
      [old],
    );
    await pool.query("update lh_leads set created_at = now() - interval '100 days', last_click_at = now() - interval '100 days' where id = $1", [recent]);
    await pool.query("update lh_events set created_at = now() - interval '7 months' where visitor_id = 'r-old'");

    await expect(anon(pool, "select lh_server_apply_retention('errado') as r")).rejects.toMatchObject({ code: "LH401" });
    const result = await anon<Record<string, number>>(pool, "select lh_server_apply_retention($1) as r", [SECRET]);
    expect(result.leads_deleted).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query("select id, ip_address, user_agent from lh_leads where workspace_id = $1", [ws.workspaceId]);
    expect(rows).toEqual([{ id: recent, ip_address: null, user_agent: null }]);
    const { rows: events } = await pool.query("select count(*)::int as n from lh_events where visitor_id = 'r-old' and workspace_id = $1", [ws.workspaceId]);
    expect(events[0].n).toBe(0);
    const { rows: audit } = await pool.query("select actor from lh_audit where workspace_id = $1 and action = 'delete_leads'", [ws.workspaceId]);
    expect(audit).toEqual([{ actor: "sistema" }]);
  });
});

describe("infrastructure numbers for the admin", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = createPool();
  });
  afterAll(() => pool.end());

  it("reports sizes, growth and whether other systems share the database", async () => {
    const admin = await setupAdmin(pool);
    const ws = await setupWorkspace(pool, "Infra");
    await collect(pool, ws.key, { type: "page_view", visitor_id: "infra-1" });
    await pool.query("create table if not exists public.outro_sistema (id int)");
    const infra = await anon<Record<string, number>>(pool, "select lh_admin_infra($1) as r", [admin.token]);
    expect(infra.other_tables).toBeGreaterThanOrEqual(1);
    expect(infra.db_bytes).toBeGreaterThan(infra.lh_bytes);
    expect(infra.lh_bytes).toBeGreaterThan(0);
    expect(infra.clients).toBeGreaterThanOrEqual(1);
    expect(infra.events_7d).toBeGreaterThanOrEqual(1);
    expect(infra.bytes_per_day).toBeGreaterThan(0);
    await expect(anon(pool, "select lh_admin_infra($1) as r", [ws.token])).rejects.toBeTruthy();
  });
});
