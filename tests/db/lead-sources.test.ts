import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

describe("lead sources (Google Sheets)", () => {
  let pool: Pool;
  let admin: { token: string };
  let ws: Setup;
  let source: { id: string; key: string };

  const forKey = (key: string) =>
    anon<{ id: string; workspace_id: string } | null>(pool, "select lh_server_source_for_key($1, $2, $3) as r", [SERVER_SECRET, randomUUID(), key]);
  const store = (lead: Record<string, unknown>, id = source.id) =>
    anon<{ lead_id: string; new: boolean }>(pool, "select lh_server_source_lead($1, $2, $3) as r", [SERVER_SECRET, id, JSON.stringify(lead)]);

  beforeAll(async () => {
    pool = createPool();
    admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Ludmilla");
  });
  afterAll(() => pool.end());

  it("creates a source with a key shown once and stored only as a hash", async () => {
    source = await anon(pool, "select lh_admin_create_source($1, $2, 'sheets', 'Formulário Kaslic') as r", [admin.token, ws.workspaceId]);
    expect(source.key).toMatch(/^lhs_[0-9a-f]{48}$/);
    const list = await anon<{ name: string; key_hint: string }[]>(pool, "select lh_admin_list_sources($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(list).toMatchObject([{ name: "Formulário Kaslic", key_hint: source.key.slice(-4) }]);
    expect(JSON.stringify(list)).not.toContain(source.key);
    const stored = (await pool.query("select key_hash from lh_lead_sources where id = $1", [source.id])).rows[0].key_hash;
    expect(stored).not.toContain(source.key);
    expect(await forKey(source.key)).toMatchObject({ id: source.id, workspace_id: ws.workspaceId });
    expect(await forKey("lhs_" + "0".repeat(48))).toBeNull();
    await expect(anon(pool, "select count(*) as r from lh_lead_sources")).rejects.toMatchObject({ code: "42501" });
  });

  it("stores Meta rows as form leads and other rows as sheet leads, each once", async () => {
    const meta = {
      meta_lead_id: "1234567890123456",
      created_time: "2026-09-28T12:15:00Z",
      name: "Carla Mendes",
      phone: "+5511988881111",
      email: "carla@email.com",
      answers: { "Qual a faixa?": "Até R$ 800 mil" },
      campaign_name: "Kaslic",
      form_id: "778899001122",
      form_name: "Kaslic Ibirapuera - 01/09",
      platform: "ig",
      is_organic: false,
    };
    const a = await store(meta);
    expect(a.new).toBe(true);
    expect(await store(meta)).toEqual({ lead_id: a.lead_id, new: false });
    const row = (await pool.query("select * from lh_leads where id = $1", [a.lead_id])).rows[0];
    expect(row).toMatchObject({
      source: "meta_form",
      source_id: source.id,
      channel: "meta_ads",
      meta_lead_id: "1234567890123456",
      meta_form_id: "778899001122",
      external_id: null,
      name: "Carla Mendes",
    });
    expect(row.extra).toEqual({ "Qual a faixa?": "Até R$ 800 mil", Formulário: "Kaslic Ibirapuera - 01/09" });

    const other = { meta_lead_id: null, external_id: "row:abc123", name: "Bruno Lima", phone: "+5511977772222", answers: {} };
    const b = await store(other);
    expect(b.new).toBe(true);
    expect(await store(other)).toEqual({ lead_id: b.lead_id, new: false });
    expect((await pool.query("select source, channel from lh_leads where id = $1", [b.lead_id])).rows[0]).toEqual({ source: "sheets", channel: null });

    // A future date is not trusted.
    const c = await store({ external_id: "row:future", name: "Futuro", created_time: "2099-01-01T00:00:00Z" });
    expect(new Date((await pool.query("select created_at from lh_leads where id = $1", [c.lead_id])).rows[0].created_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const sources = await anon<{ leads_received: number; last_received_at: string }[]>(pool, "select lh_admin_list_sources($1, $2) as r", [
      admin.token,
      ws.workspaceId,
    ]);
    expect(sources[0].leads_received).toBe(3);
    await expect(store({ meta_lead_id: "abc", name: "x" })).rejects.toMatchObject({ code: "22023" });
  });

  it("the sheet filters by source and the numbers are split by source", async () => {
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "lp-visitor-1", channel: "direct" });
    const list = (source: string | null) =>
      anon<{ total: number }>(pool, "select lh_list_leads(p_token => $1, p_source => $2) as r", [ws.token, source]).then((r) => r.total);
    expect(await list(null)).toBe(4);
    expect(await list("meta_form")).toBe(1);
    expect(await list("sheets")).toBe(2);
    expect(await list("lp")).toBe(1);

    const stats = await anon<{ leads: number; by_source: { source: string; leads: number }[] }>(pool, "select lh_stats($1) as r", [ws.token]);
    expect(stats.leads).toBe(4);
    expect(Object.fromEntries(stats.by_source.map((s) => [s.source, s.leads]))).toEqual({ sheets: 2, meta_form: 1, lp: 1 });
    const metrics = await anon<{ by_source: { source: string }[] }>(pool, "select lh_metrics($1) as r", [ws.token]);
    expect(metrics.by_source.map((s) => s.source).sort()).toEqual(["lp", "meta_form", "sheets"]);
  });

  it("a new key replaces the old one; paused or removed sources stop receiving; leads stay", async () => {
    const newKey = await anon<string>(pool, "select lh_admin_rotate_source_key($1, $2, $3) as r", [admin.token, ws.workspaceId, source.id]);
    expect(await forKey(source.key)).toBeNull();
    expect(await forKey(newKey)).toMatchObject({ id: source.id });

    await anon(pool, "select lh_admin_update_source($1, $2, $3, false) as r", [admin.token, ws.workspaceId, source.id]);
    expect(await forKey(newKey)).toBeNull();
    await expect(store({ external_id: "row:x", name: "Pausado" })).rejects.toMatchObject({ code: "LH404" });

    await anon(pool, "select lh_admin_update_source($1, $2, $3, null, true) as r", [admin.token, ws.workspaceId, source.id]);
    expect((await pool.query("select count(*)::int n from lh_leads where workspace_id = $1 and source in ('meta_form','sheets')", [ws.workspaceId])).rows[0].n).toBe(3);
  });

  it("another client's source cannot be touched", async () => {
    const other = await setupWorkspace(pool, "Outro");
    const theirs = await anon<{ id: string }>(pool, "select lh_admin_create_source($1, $2, 'sheets', 'Deles') as r", [admin.token, other.workspaceId]);
    await expect(anon(pool, "select lh_admin_update_source($1, $2, $3, false) as r", [admin.token, ws.workspaceId, theirs.id])).rejects.toMatchObject({
      code: "LH404",
    });
  });
});
