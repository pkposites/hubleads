import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

const SECRET = "test-server-secret-0123456789abcdef";

interface History {
  type: string;
  from: string | null;
  to: string | null;
  actor: string;
}

describe("attendance tools", () => {
  let pool: Pool;
  let ws: Setup;
  let adminToken: string;

  beforeAll(async () => {
    pool = createPool();
    await pool.query("select lh_private.set_server_secret($1)", [SECRET]);
    ws = await setupWorkspace(pool, "Clínica Atendimento");
    const admin = await setupAdmin(pool);
    adminToken = (
      await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, ws.workspaceId])
    ).token;
  });

  afterAll(() => pool.end());

  const click = async (visitor: string) => {
    const r = await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: visitor, code: "AB23" });
    return r.lead_id!;
  };
  const update = (id: string, patch: Record<string, unknown>, token = ws.token) =>
    anon<Record<string, unknown>>(pool, "select lh_update_lead($1, $2, $3) as r", [token, id, JSON.stringify(patch)]);
  const detail = (id: string) =>
    anon<{ lead: Record<string, unknown>; history: History[]; meta: unknown[] }>(
      pool,
      "select lh_lead_detail($1, $2) as r",
      [ws.token, id],
    );

  it("keeps a history of every change with who made it", async () => {
    const id = await click("hist-1");
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "hist-1", phone: "11912345678" });
    await update(id, { status: "agendado", notes: "Quinta 14h" });

    const { history } = await detail(id);
    expect(history.map((h) => h.type)).toEqual(["created", "click", "phone", "status", "note"]);
    expect(history[0].actor).toBe("lp");
    expect(history[2]).toMatchObject({ to: "11912345678", actor: "lp" });
    expect(history[3]).toMatchObject({ from: "novo", to: "agendado", actor: "atendente" });
  });

  it("requires a reason to mark a lead as lost and clears it when reopened", async () => {
    const id = await click("lost-1");
    await expect(update(id, { status: "perdido" })).rejects.toMatchObject({ code: "22023" });
    const lost = await update(id, { status: "perdido", lost_reason: "Preço" });
    expect(lost).toMatchObject({ status: "perdido", lost_reason: "Preço" });
    expect(await update(id, { notes: "ligar em março" })).toMatchObject({ lost_reason: "Preço" });
    expect(await update(id, { status: "em_atendimento" })).toMatchObject({ lost_reason: null });

    const { history } = await detail(id);
    expect(history.find((h) => h.type === "status")?.to).toBe("perdido · Preço");
  });

  it("records the first contact when a message is sent or the status moves on", async () => {
    const id = await click("contact-1");
    const sent = await anon<Record<string, unknown>>(pool, "select lh_log_contact($1, $2, $3) as r", [
      ws.token,
      id,
      "Primeiro contato",
    ]);
    expect(sent.status).toBe("em_atendimento");
    expect(sent.first_contact_at).not.toBeNull();

    const again = await anon<Record<string, unknown>>(pool, "select lh_log_contact($1, $2, $3) as r", [ws.token, id, "Retorno"]);
    expect(again.first_contact_at).toBe(sent.first_contact_at);
    const types = (await detail(id)).history.map((h) => h.type);
    expect(types.filter((t) => t === "message")).toHaveLength(2);

    const other = await click("contact-2");
    expect((await update(other, { status: "agendado" })).first_contact_at).not.toBeNull();
  });

  it("builds the queue: waiting oldest first, overdue and today's follow-ups", async () => {
    const other = await setupWorkspace(pool, "Fila isolada");
    const first = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "q-1" })).lead_id!;
    const second = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "q-2" })).lead_id!;
    const third = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "q-3" })).lead_id!;
    const past = new Date(Date.now() - 3600_000).toISOString();
    await update(second, { status: "em_atendimento", next_contact_at: past }, other.token);
    await update(third, { status: "venda", next_contact_at: past }, other.token);

    const queue = await anon<{ waiting: { id: string }[]; overdue: { id: string }[]; today: unknown[] }>(
      pool,
      "select lh_queue($1) as r",
      [other.token],
    );
    expect(queue.waiting.map((l) => l.id)).toEqual([first]);
    expect(queue.overdue.map((l) => l.id)).toEqual([second]);
  });

  it("seeds message templates and lets only admins change them", async () => {
    const list = await anon<{ id: string; name: string; body: string }[]>(pool, "select lh_list_templates($1) as r", [ws.token]);
    expect(list.map((t) => t.name)).toEqual(["Primeiro contato", "Confirmar avaliação", "Retorno"]);
    expect(list[0].body).toContain("{nome}");

    await expect(
      anon(pool, "select lh_save_template($1, null, 'X', 'Y', 1) as r", [ws.token]),
    ).rejects.toMatchObject({ code: "LH403" });
    const created = await anon<{ id: string }>(pool, "select lh_save_template($1, null, $2, $3, 4) as r", [
      adminToken,
      "Pós-venda",
      "Oi {nome}, como foi?",
    ]);
    await anon(pool, "select lh_save_template($1, $2, $3, $4, 4) as r", [adminToken, created.id, "Pós-venda", "Tudo certo, {nome}?"]);
    let names = (await anon<{ name: string; body: string }[]>(pool, "select lh_list_templates($1) as r", [ws.token]));
    expect(names.at(-1)).toMatchObject({ name: "Pós-venda", body: "Tudo certo, {nome}?" });
    await anon(pool, "select lh_delete_template($1, $2) as r", [adminToken, created.id]);
    names = await anon(pool, "select lh_list_templates($1) as r", [ws.token]);
    expect(names).toHaveLength(3);
  });

  it("serves push targets only to the server", async () => {
    await anon(pool, "select lh_push_subscribe($1, $2, $3, $4) as r", [ws.token, "https://push.example.com/abc", "p256", "auth"]);
    const id = await click("push-1");
    await expect(anon(pool, "select lh_server_new_lead_push($1, $2) as r", ["errado", id])).rejects.toMatchObject({
      code: "LH401",
    });
    const push = await anon<{ slug: string; lead: { code: string }; targets: { endpoint: string }[] }>(
      pool,
      "select lh_server_new_lead_push($1, $2) as r",
      [SECRET, id],
    );
    expect(push.slug).toBe(ws.slug);
    expect(push.targets.map((t) => t.endpoint)).toEqual(["https://push.example.com/abc"]);

    await anon(pool, "select lh_server_push_gone($1, $2) as r", [SECRET, "https://push.example.com/abc"]);
    expect((await anon<{ targets: unknown[] }>(pool, "select lh_server_new_lead_push($1, $2) as r", [SECRET, id])).targets).toEqual([]);
  });

  it("keeps the Meta token write-only and logs conversions", async () => {
    const admin = await setupAdmin(pool);
    const other = await setupWorkspace(pool, "Meta clínica");
    const id = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "capi-1" })).lead_id!;

    expect(await anon(pool, "select lh_server_meta_payload($1, $2) as r", [SECRET, id])).toBeNull();
    await expect(
      anon(pool, "select lh_admin_set_meta($1, $2, '123456789', '', null, true, true, true) as r", [admin.token, other.workspaceId]),
    ).rejects.toMatchObject({ code: "22023" });
    await anon(pool, "select lh_admin_set_meta($1, $2, '123456789', 'EAAtokensecretoXYZ9', 'TEST1', true, true, true) as r", [
      admin.token,
      other.workspaceId,
    ]);
    // Blank token keeps the saved one.
    await anon(pool, "select lh_admin_set_meta($1, $2, '123456789', '', null, true, true, false) as r", [
      admin.token,
      other.workspaceId,
    ]);

    const shown = await anon<Record<string, unknown>>(pool, "select lh_admin_get_meta($1, $2) as r", [admin.token, other.workspaceId]);
    expect(shown).toMatchObject({ configured: true, token_hint: "••••XYZ9", send_purchase: false, test_event_code: null });
    expect(JSON.stringify(shown)).not.toContain("EAAtoken");

    const payload = await anon<{ config: { access_token: string }; lead: { id: string }; sent: string[] }>(
      pool,
      "select lh_server_meta_payload($1, $2) as r",
      [SECRET, id],
    );
    expect(payload.config.access_token).toBe("EAAtokensecretoXYZ9");
    expect(payload.sent).toEqual([]);

    await anon(pool, "select lh_server_meta_log($1, $2, $3, 'Schedule', 'ev1', true, false, '{}') as r", [
      SECRET,
      other.workspaceId,
      id,
    ]);
    const after = await anon<{ sent: string[] }>(pool, "select lh_server_meta_payload($1, $2) as r", [SECRET, id]);
    expect(after.sent).toEqual(["Schedule"]);
    const history = await anon<{ history: History[]; meta: unknown[] }>(pool, "select lh_lead_detail($1, $2) as r", [other.token, id]);
    expect(history.history.at(-1)).toMatchObject({ type: "meta", to: "Schedule enviado" });
    expect(history.meta).toHaveLength(1);

    await expect(anon(pool, "select lh_admin_get_meta($1, $2) as r", [other.token, other.workspaceId])).rejects.toBeTruthy();
  });

  it("measures time to first contact and lost reasons", async () => {
    const other = await setupWorkspace(pool, "Métricas atendimento");
    const a = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "m-1" })).lead_id!;
    const b = (await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "m-2" })).lead_id!;
    await collect(pool, other.key, { type: "whatsapp_click", visitor_id: "m-3" });
    await pool.query("update lh_leads set created_at = now() - interval '10 minutes' where id = $1", [b]);
    await update(a, { status: "em_atendimento" }, other.token);
    await update(b, { status: "perdido", lost_reason: "Sem resposta" }, other.token);

    const m = await anon<Record<string, unknown>>(pool, "select lh_attendance_metrics($1, null) as r", [other.token]);
    expect(m).toMatchObject({ contacted: 2, within_5_min: 1, waiting: 1 });
    expect(Number(m.first_contact_median_min)).toBeGreaterThan(4);
    expect(m.lost_reasons).toEqual([{ reason: "Sem resposta", count: 1 }]);
  });

  it("cannot read tables directly", async () => {
    for (const table of ["lh_lead_history", "lh_templates", "lh_push_subscriptions", "lh_meta_configs", "lh_meta_events"]) {
      await expect(anon(pool, `select count(*) as r from ${table}`)).rejects.toMatchObject({ code: "42501" });
    }
  });
});
