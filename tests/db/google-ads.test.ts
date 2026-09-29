import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

type Feed = { rows?: { gclid: string; name: string; time: string; value: number | null }[]; limited?: boolean } | null;

describe("conversions back to Google Ads (scheduled file)", () => {
  let pool: Pool;
  let admin: { token: string };
  let ws: Setup;
  let access: { feed_id: string; username: string; password: string };

  const feed = (feedId: string, username: string, password: string) =>
    anon<Feed>(pool, "select lh_server_google_ads_feed($1, $2, $3, $4, $5) as r", [SERVER_SECRET, randomUUID(), feedId, username, password]);
  const leadOf = async (visitor: string) =>
    (await pool.query("select id from lh_leads where workspace_id = $1 and visitor_id = $2", [ws.workspaceId, visitor])).rows[0].id as string;

  beforeAll(async () => {
    pool = createPool();
    admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Google");
    // A lead from a Google ad, one from Meta, and a Google lead that is sold.
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "g-1", attribution: { utm_source: "google", gclid: "CjwKCAjwLEAD" } });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "m-1", attribution: { utm_source: "facebook", fbclid: "IwAR1" } });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "g-2", attribution: { gclid: "CjwKCAjwSALE" } });
  });
  afterAll(() => pool.end());

  it("is off until the admin turns it on; the password is shown once and kept only as a hash", async () => {
    expect(await anon(pool, "select lh_admin_get_google_ads($1, $2) as r", [admin.token, ws.workspaceId])).toBeNull();
    access = await anon(pool, "select lh_admin_google_ads_credentials($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(access.username).toMatch(/^leadhub-[0-9a-f]{8}$/);
    expect(access.password).toMatch(/^[0-9a-f]{36}$/);
    const settings = await anon<Record<string, unknown>>(pool, "select lh_admin_get_google_ads($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(settings).toMatchObject({ enabled: true, lead_name: "Lead Hub - Lead", with_gclid_90d: 2 });
    expect(settings).not.toHaveProperty("password");
    expect(settings).not.toHaveProperty("password_hash");
    expect(JSON.stringify(await pool.query("select * from lh_google_ads where workspace_id = $1", [ws.workspaceId]).then((r) => r.rows))).not.toContain(access.password);
  });

  it("lists Lead, Agendamento and Venda (with value) only for Google clicks", async () => {
    const sale = await leadOf("g-2");
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [ws.token, sale, JSON.stringify({ status: "agendado" })]);
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [ws.token, sale, JSON.stringify({ status: "venda", sale_value: 2480 })]);

    const result = await feed(access.feed_id, access.username, access.password);
    const rows = result!.rows!.map((r) => [r.gclid, r.name, r.value === null ? null : Number(r.value)]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["CjwKCAjwLEAD", "Lead Hub - Lead", null],
        ["CjwKCAjwSALE", "Lead Hub - Lead", null],
        ["CjwKCAjwSALE", "Lead Hub - Agendamento", null],
        ["CjwKCAjwSALE", "Lead Hub - Venda", 2480],
      ]),
    );
    expect(rows).toHaveLength(4);
    expect(result!.rows!.every((r) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.time))).toBe(true);
    const status = await anon<{ last_rows: number; last_fetch_at: string }>(pool, "select lh_admin_get_google_ads($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(status.last_rows).toBe(4);
  });

  it("follows the chosen names and conversions", async () => {
    await anon(pool, "select lh_admin_update_google_ads($1, $2, $3) as r", [
      admin.token,
      ws.workspaceId,
      JSON.stringify({ send_lead: false, purchase_name: "Venda Andressa" }),
    ]);
    const rows = (await feed(access.feed_id, access.username, access.password))!.rows!;
    expect(rows.map((r) => r.name).sort()).toEqual(["Lead Hub - Agendamento", "Venda Andressa"]);
    await expect(
      anon(pool, "select lh_admin_update_google_ads($1, $2, $3) as r", [admin.token, ws.workspaceId, JSON.stringify({ lead_name: "  " })]),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("wrong user or password, a new password, pausing or removing close the file", async () => {
    expect(await feed(access.feed_id, access.username, "errada")).toBeNull();
    expect(await feed(access.feed_id, "outro", access.password)).toBeNull();
    expect(await feed(randomUUID(), access.username, access.password)).toBeNull();

    const fresh = await anon<{ password: string; feed_id: string }>(pool, "select lh_admin_google_ads_credentials($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(fresh.feed_id).toBe(access.feed_id);
    expect(await feed(access.feed_id, access.username, access.password)).toBeNull();
    expect(await feed(access.feed_id, access.username, fresh.password)).toMatchObject({ rows: expect.any(Array) });

    await anon(pool, "select lh_admin_update_google_ads($1, $2, $3) as r", [admin.token, ws.workspaceId, JSON.stringify({ enabled: false })]);
    expect(await feed(access.feed_id, access.username, fresh.password)).toBeNull();
    await anon(pool, "select lh_admin_update_google_ads($1, $2, '{}', true) as r", [admin.token, ws.workspaceId]);
    expect(await anon(pool, "select lh_admin_get_google_ads($1, $2) as r", [admin.token, ws.workspaceId])).toBeNull();
  });

  it("needs the server secret; the table is closed; another client's admin cannot touch it", async () => {
    await expect(anon(pool, "select lh_server_google_ads_feed('x', 'c', $1, 'u', 'p') as r", [randomUUID()])).rejects.toMatchObject({ code: "LH401" });
    await expect(anon(pool, "select count(*) as r from lh_google_ads")).rejects.toMatchObject({ code: "42501" });
  });
});
