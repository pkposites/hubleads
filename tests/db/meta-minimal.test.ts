import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

const CIPHER = "enc:v1:aXZpdml2aXZpdml2.dGFndGFndGFn.Y2lwaGVydGV4dA";
const FBC = "fb.1.1759500000000.IwAR1abc";

describe("measurement without cookies (visitors who did not accept)", () => {
  let pool: Pool;
  let ws: Setup;
  let adminToken: string;

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Sem cookies");
    adminToken = (await setupAdmin(pool)).token;
  });
  afterAll(() => pool.end());

  const setMeta = () =>
    anon(pool, "select lh_admin_set_meta($1, $2, '123456789', $3, 'XYZ9', null, true, true, true) as r", [adminToken, ws.workspaceId, CIPHER]);
  const setMinimal = (on: boolean) => anon(pool, "select lh_admin_set_meta_minimal($1, $2, $3) as r", [adminToken, ws.workspaceId, on]);
  const refusedClick = (visitor: string) =>
    collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: visitor,
      consent: false,
      name: "Ana",
      ip_address: "200.1.2.3",
      user_agent: "Mozilla/5.0",
      attribution: { fbc: FBC, landing_url: "https://clinica.com.br/lp", utm_campaign: "Gestantes", fbp: "fb.1.1.99" },
    });
  const row = async (id: string) =>
    (await pool.query("select ip_address, user_agent, fbc, fbp, utm_campaign, landing_url, tracking_consent from lh_leads where id = $1", [id])).rows[0];
  const view = (key = ws.key, host = "clinica.com.br") =>
    anon<Record<string, unknown> | null>(pool, "select lh_server_meta_view($1, $2, $3, $4) as r", [SERVER_SECRET, randomUUID(), key, host]);
  const pending = async () => {
    const ids = await anon<string[]>(pool, "select lh_server_meta_pending($1, 100) as r", [SERVER_SECRET]);
    const mine = await pool.query("select id from lh_leads where workspace_id = $1 and id = any($2::uuid[])", [ws.workspaceId, ids]);
    return ids.filter((id) => mine.rows.some((r) => r.id === id));
  };

  it("keeps nothing of the visit for clients without the Meta setup", async () => {
    const lead = (await refusedClick("nc-1")).lead_id!;
    expect(await row(lead)).toMatchObject({ ip_address: null, user_agent: null, fbc: null, fbp: null, utm_campaign: null, tracking_consent: false });
    expect(await view()).toBeNull();
  });

  it("with Meta on (default), keeps only IP, browser, the ad click id and the page, and owes Meta the Lead", async () => {
    await setMeta();
    const settings = await anon<Record<string, unknown>>(pool, "select lh_admin_get_meta($1, $2) as r", [adminToken, ws.workspaceId]);
    expect(settings).toMatchObject({ minimal_tracking: true, minimal_views_today: 0 });

    const lead = (await refusedClick("mc-1")).lead_id!;
    expect(await row(lead)).toMatchObject({
      ip_address: "200.1.2.3",
      user_agent: "Mozilla/5.0",
      fbc: FBC,
      fbp: null,
      utm_campaign: null,
      landing_url: "https://clinica.com.br/lp",
      tracking_consent: false,
    });
    expect(await pending()).toContain(lead);
    const payload = await anon<{ config: { minimal_tracking: boolean } }>(pool, "select lh_server_meta_payload($1, $2) as r", [SERVER_SECRET, lead]);
    expect(payload.config.minimal_tracking).toBe(true);

    await anon(pool, "select lh_server_meta_log($1, $2, $3, 'Lead', 'id', true, false, 'ok') as r", [SERVER_SECRET, ws.workspaceId, lead]);
    expect(await pending()).not.toContain(lead);
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [ws.token, lead, JSON.stringify({ status: "agendado" })]);
    expect(await pending()).toContain(lead);
  });

  it("gives the server the pixel for a page view, counts it, and refuses other sites or keys", async () => {
    const config = await view();
    expect(config).toEqual({ pixel_id: "123456789", access_token: CIPHER, test_event_code: null });
    await view();
    const settings = await anon<{ minimal_views_today: number }>(pool, "select lh_admin_get_meta($1, $2) as r", [adminToken, ws.workspaceId]);
    expect(settings.minimal_views_today).toBe(2);
    // A page limited to its site: other sites get nothing.
    await pool.query("update lh_pages set domains = '{clinica.com.br}' where public_key = $1", [ws.key]);
    expect(await view(ws.key, "outro-site.com")).toBeNull();
    expect(await view(ws.key, "clinica.com.br")).not.toBeNull();
    expect(await view("pk_nao_existe")).toBeNull();
    await expect(anon(pool, "select lh_server_meta_view('x', 'c', $1, 'clinica.com.br') as r", [ws.key])).rejects.toMatchObject({ code: "LH401" });
  });

  it("turned off, goes back to keeping only the typed contact", async () => {
    await setMinimal(false);
    const lead = (await refusedClick("off-1")).lead_id!;
    expect(await row(lead)).toMatchObject({ ip_address: null, user_agent: null, fbc: null });
    expect(await view()).toBeNull();
    expect(await pending()).toEqual([]);
    await setMinimal(true);
  });

  it("only the client's admin may change it", async () => {
    const other = await setupWorkspace(pool, "Outro");
    await expect(
      anon(pool, "select lh_admin_set_meta_minimal($1, $2, false) as r", [ws.token, other.workspaceId]),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^LH40[13]$/) });
    await expect(anon(pool, "select lh_admin_set_meta_minimal($1, $2, false) as r", [adminToken, other.workspaceId])).rejects.toMatchObject({
      code: "LH404",
    });
  });
});
