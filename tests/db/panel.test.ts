import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, listLeads, setupWorkspace, type Setup } from "./harness";

describe("panel access and editing", () => {
  let pool: Pool;
  let a: Setup;
  let b: Setup;
  let leadA: string;

  beforeAll(async () => {
    pool = createPool();
    a = await setupWorkspace(pool, "Dra Letícia");
    b = await setupWorkspace(pool, "Outra clínica");
    leadA = (await collect(pool, a.key, { type: "whatsapp_click", visitor_id: "a-1", code: "AAAA" })).lead_id!;
    await collect(pool, b.key, { type: "whatsapp_click", visitor_id: "b-1", code: "BBBB" });
  });

  afterAll(() => pool.end());

  it("logs in only with the right password", async () => {
    expect(await anon(pool, "select lh_login($1, $2) as r", [a.slug, "errada"])).toBeNull();
    expect(await anon(pool, "select lh_login($1, $2) as r", ["nao-existe", a.password])).toBeNull();
    const ok = await anon<{ token: string; slug: string }>(pool, "select lh_login($1, $2) as r", [a.slug, a.password]);
    expect(ok.slug).toBe(a.slug);
    expect(ok.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows each session only its own workspace", async () => {
    const mine = await listLeads(pool, a.token);
    expect(mine.rows.map((r) => r.code)).toEqual(["AAAA"]);
    const theirs = await listLeads(pool, b.token);
    expect(theirs.rows.map((r) => r.code)).toEqual(["BBBB"]);
  });

  it("does not let one workspace edit another's lead", async () => {
    await expect(
      anon(pool, "select lh_update_lead($1, $2, $3) as r", [b.token, leadA, JSON.stringify({ phone: "x" })]),
    ).rejects.toMatchObject({ code: "LH404" });
  });

  it("rejects missing, wrong and expired sessions", async () => {
    for (const token of [null, "", "0".repeat(64)]) {
      await expect(listLeads(pool, token as string)).rejects.toMatchObject({ code: "LH401" });
    }
    await pool.query("update lh_sessions set expires_at = now() - interval '1 minute' where workspace_id = $1", [
      b.workspaceId,
    ]);
    await expect(listLeads(pool, b.token)).rejects.toMatchObject({ code: "LH401" });
  });

  it("ends the session on logout", async () => {
    const s = await anon<{ token: string }>(pool, "select lh_login($1, $2) as r", [a.slug, a.password]);
    await anon(pool, "select lh_logout($1) as r", [s.token]);
    await expect(listLeads(pool, s.token)).rejects.toMatchObject({ code: "LH401" });
  });

  it("lets the attendant fill the phone, status, notes and sale", async () => {
    const updated = await anon<Record<string, unknown>>(pool, "select lh_update_lead($1, $2, $3) as r", [
      a.token,
      leadA,
      JSON.stringify({ phone: "+5511999990000", status: "venda", notes: "Fechou avaliação", sale_value: "18000" }),
    ]);
    expect(updated).toMatchObject({ phone: "+5511999990000", status: "venda", notes: "Fechou avaliação", sale_value: 18000 });

    // Fields outside the patch stay untouched; unknown fields are ignored.
    const again = await anon<Record<string, unknown>>(pool, "select lh_update_lead($1, $2, $3) as r", [
      a.token,
      leadA,
      JSON.stringify({ notes: "", code: "HACK", workspace_id: b.workspaceId }),
    ]);
    expect(again).toMatchObject({ phone: "+5511999990000", notes: null, code: "AAAA" });
  });

  it("refuses an invalid status", async () => {
    await expect(
      anon(pool, "select lh_update_lead($1, $2, $3) as r", [a.token, leadA, JSON.stringify({ status: "xyz" })]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("adds a lead by hand for a WhatsApp contact without a click", async () => {
    const lead = await anon<Record<string, unknown>>(pool, "select lh_create_lead($1, $2, $3) as r", [
      a.token,
      "Cliente do balcão",
      "+5511988887777",
    ]);
    expect(lead).toMatchObject({ source: "manual", channel: "whatsapp_direto", phone: "+5511988887777" });
    expect((await listLeads(pool, a.token, { search: "balcão" })).total).toBe(1);
  });

  it("summarises the period", async () => {
    await collect(pool, a.key, { type: "page_view", visitor_id: "a-1" });
    await collect(pool, a.key, { type: "page_view", visitor_id: "a-2" });
    await collect(pool, a.key, { type: "page_view", visitor_id: "a-2" });
    const stats = await anon(pool, "select lh_stats($1) as r", [a.token]);
    expect(stats).toEqual({ visitors: 2, clicks: 1, leads: 2, with_phone: 2, sales: 1, revenue: 18000 });
  });

  it("never lets API roles read the tables directly", async () => {
    for (const table of ["lh_workspaces", "lh_sessions", "lh_pages", "lh_leads", "lh_events"]) {
      await expect(anon(pool, `select * from ${table}`)).rejects.toThrow(/permission denied/);
    }
    await expect(anon(pool, "select lh_private.random_code() as r")).rejects.toThrow(/permission denied/);
  });
});
