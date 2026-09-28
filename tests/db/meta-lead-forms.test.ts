import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

const ENC = "enc:v1:aaaa.bbbb.cccc";
const now = () => Math.floor(Date.now() / 1000);

describe("leads from Meta native forms", () => {
  let pool: Pool;
  let admin: { token: string };
  let ws: Setup;
  let formRow: string;

  const setForm = (formId: string, since = now() - 3600, enabled = true) =>
    anon(pool, "select lh_admin_set_lead_form($1, $2, '310343358836414', 'Ludmilla Silva - Corretora', $3, 'Kaslic Ibirapuera - 01/09', $4, $5) as r", [
      admin.token,
      ws.workspaceId,
      formId,
      enabled,
      since,
    ]);
  const store = (lead: Record<string, unknown>) =>
    anon<{ lead_id: string; new: boolean }>(pool, "select lh_server_meta_form_lead($1, $2, $3) as r", [SERVER_SECRET, formRow, JSON.stringify(lead)]);

  beforeAll(async () => {
    pool = createPool();
    admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Ludmilla");
  });
  afterAll(() => pool.end());

  it("saves the token encrypted and connects a form", async () => {
    await expect(
      anon(pool, "select lh_admin_set_lead_token($1, $2, 'EAAplain', '1234') as r", [admin.token, ws.workspaceId]),
    ).rejects.toMatchObject({ code: "23514" });
    await anon(pool, "select lh_admin_set_lead_token($1, $2, $3, 'wxyz') as r", [admin.token, ws.workspaceId, ENC]);
    await setForm("778899001122");
    const data = await anon<{ has_token: boolean; token_hint: string; forms: { id: string; form_name: string; enabled: boolean }[] }>(
      pool,
      "select lh_admin_get_lead_forms($1, $2) as r",
      [admin.token, ws.workspaceId],
    );
    expect(data).toMatchObject({ has_token: true, token_hint: "wxyz", forms: [{ form_name: "Kaslic Ibirapuera - 01/09", enabled: true }] });
    formRow = data.forms[0].id;
    expect(JSON.stringify(data)).not.toContain(ENC);

    await expect(setForm("778899001133", now() - 100 * 86400)).rejects.toMatchObject({ code: "22023" });
  });

  it("lists enabled forms for the sync, with the encrypted token", async () => {
    const due = await anon<{ id: string; access_token: string; form_id: string }[]>(pool, "select lh_server_lead_forms_due($1) as r", [SERVER_SECRET]);
    expect(due.find((f) => f.id === formRow)).toMatchObject({ form_id: "778899001122", access_token: ENC });
    await expect(anon(pool, "select lh_server_lead_forms_due('x') as r")).rejects.toMatchObject({ code: "LH401" });
  });

  it("stores each Meta lead once, as a row of the sheet", async () => {
    const lead = {
      meta_lead_id: "9876543210987654",
      created_time: "2026-09-28T12:00:00+0000",
      name: "Ana Paula",
      phone: "+5511912345678",
      email: "ana@email.com",
      answers: { "Qual o seu orçamento?": "R$ 500 mil" },
      campaign_name: "Kaslic",
      adset_name: "Moema",
      ad_name: "Vídeo",
      platform: "ig",
      is_organic: false,
    };
    const first = await store(lead);
    expect(first.new).toBe(true);
    expect(await store(lead)).toEqual({ lead_id: first.lead_id, new: false });

    const { rows } = await pool.query("select * from lh_leads where id = $1", [first.lead_id]);
    expect(rows[0]).toMatchObject({
      source: "meta_form",
      status: "novo",
      channel: "meta_ads",
      name: "Ana Paula",
      phone: "+5511912345678",
      email: "ana@email.com",
      meta_lead_id: "9876543210987654",
      meta_form_id: "778899001122",
      campaign_name: "Kaslic",
      site_source_name: "ig",
    });
    expect(rows[0].extra).toEqual({ "Qual o seu orçamento?": "R$ 500 mil", Formulário: "Kaslic Ibirapuera - 01/09" });
    expect(rows[0].created_at.toISOString()).toBe("2026-09-28T12:00:00.000Z");
    expect(rows[0].code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);

    // The attendant's queue and the sheet see it like any other lead.
    const list = await anon<{ rows: { id: string }[] }>(pool, "select lh_list_leads(p_token => $1) as r", [ws.token]);
    expect(list.rows.map((r) => r.id)).toContain(first.lead_id);

    const cursor = now() + 60;
    await anon(pool, "select lh_server_lead_form_synced($1, $2, $3, null) as r", [SERVER_SECRET, formRow, cursor]);
    const form = (await pool.query("select cursor_time, leads_imported, last_error from lh_meta_lead_forms where id = $1", [formRow])).rows[0];
    expect(form).toMatchObject({ cursor_time: String(cursor), leads_imported: 1, last_error: null });
  });

  it("rejects bad lead ids and keeps the cursor from going back", async () => {
    await expect(store({ meta_lead_id: "abc" })).rejects.toMatchObject({ code: "22023" });
    await anon(pool, "select lh_server_lead_form_synced($1, $2, $3, 'Token inválido') as r", [SERVER_SECRET, formRow, 1]);
    const form = (await pool.query("select cursor_time, last_error from lh_meta_lead_forms where id = $1", [formRow])).rows[0];
    expect(Number(form.cursor_time)).toBeGreaterThan(now());
    expect(form.last_error).toBe("Token inválido");
  });

  it("owes Meta the Lead CRM event until it is sent", async () => {
    await pool.query(
      `insert into lh_meta_configs (workspace_id, pixel_id, access_token, enabled) values ($1, '1122334455', $2, true)
       on conflict (workspace_id) do update set enabled = true, test_event_code = null`,
      [ws.workspaceId, ENC],
    );
    const fresh = await store({ meta_lead_id: "5550001112223", created_time: new Date().toISOString(), name: "Bia" });
    let pending = await anon<string[]>(pool, "select lh_server_meta_pending($1) as r", [SERVER_SECRET]);
    expect(pending).toContain(fresh.lead_id);
    await anon(pool, "select lh_server_meta_log($1, $2, $3, 'Lead', 'x.Lead', true, false, 'ok') as r", [SERVER_SECRET, ws.workspaceId, fresh.lead_id]);
    pending = await anon<string[]>(pool, "select lh_server_meta_pending($1) as r", [SERVER_SECRET]);
    expect(pending).not.toContain(fresh.lead_id);

    const payload = await anon<{ lead: { source: string; meta_lead_id: string; email: string | null } }>(
      pool,
      "select lh_server_meta_payload($1, $2) as r",
      [SERVER_SECRET, fresh.lead_id],
    );
    expect(payload.lead).toMatchObject({ source: "meta_form", meta_lead_id: "5550001112223" });
  });

  it("removing the token pauses every form", async () => {
    await anon(pool, "select lh_admin_set_lead_token($1, $2, null, null) as r", [admin.token, ws.workspaceId]);
    const due = await anon<{ id: string }[]>(pool, "select lh_server_lead_forms_due($1) as r", [SERVER_SECRET]);
    expect(due.map((f) => f.id)).not.toContain(formRow);
    expect((await pool.query("select enabled from lh_meta_lead_forms where id = $1", [formRow])).rows[0].enabled).toBe(false);
  });
});
