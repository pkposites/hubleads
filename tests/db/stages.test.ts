import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

describe("steps and colours (for the team only)", () => {
  let pool: Pool;
  let ws: Setup;
  let adminPanel: string;
  let leadId: string;

  const update = (token: string, patch: unknown) =>
    anon<{ stage: string | null; color: string | null; status: string }>(pool, "select lh_update_lead($1, $2, $3) as r", [
      token,
      leadId,
      JSON.stringify(patch),
    ]);
  const total = (filters: Record<string, string>) =>
    anon<{ total: number }>(pool, "select lh_list_leads(p_token => $1, p_stage => $2, p_color => $3) as r", [
      ws.token,
      filters.stage ?? null,
      filters.color ?? null,
    ]).then((r) => r.total);

  beforeAll(async () => {
    pool = createPool();
    const admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Etapas");
    adminPanel = (await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, ws.workspaceId])).token;
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "etapa-1" });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "etapa-2" });
    leadId = (await pool.query("select id from lh_leads where workspace_id = $1 order by created_at limit 1", [ws.workspaceId])).rows[0].id;
  });
  afterAll(() => pool.end());

  it("each client starts with a list of steps and says which statuses go to Meta", async () => {
    const config = await anon<{ stages: string[]; meta: { schedule: boolean; purchase: boolean } }>(pool, "select lh_sheet_config($1) as r", [ws.token]);
    expect(config.stages).toEqual(["Primeiro contato", "Em conversa", "Proposta enviada", "Negociando"]);
    expect(config.meta).toEqual({ schedule: false, purchase: false });
  });

  it("only a panel admin changes the steps, and they are validated", async () => {
    await expect(anon(pool, "select lh_set_stages($1, $2) as r", [ws.token, JSON.stringify(["A"])])).rejects.toMatchObject({ code: "LH403" });
    expect(await anon(pool, "select lh_set_stages($1, $2) as r", [adminPanel, JSON.stringify([" Enviou material ", "Visita marcada"])])).toEqual([
      "Enviou material",
      "Visita marcada",
    ]);
    for (const bad of [["A", "A"], [""], [1], { a: 1 }, Array.from({ length: 21 }, (_, i) => `E${i}`)]) {
      await expect(anon(pool, "select lh_set_stages($1, $2) as r", [adminPanel, JSON.stringify(bad)])).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("the attendant sets a step and a colour without touching the status", async () => {
    const lead = await update(ws.token, { stage: "Visita marcada", color: "verde" });
    expect(lead).toMatchObject({ stage: "Visita marcada", color: "verde", status: "novo" });
    await expect(update(ws.token, { stage: "Não existe" })).rejects.toMatchObject({ code: "22023" });
    await expect(update(ws.token, { color: "azul" })).rejects.toMatchObject({ code: "22023" });
    // Other changes keep them.
    expect(await update(ws.token, { notes: "ok" })).toMatchObject({ stage: "Visita marcada", color: "verde" });

    expect(await total({ stage: "Visita marcada" })).toBe(1);
    expect(await total({ stage: "-" })).toBe(1);
    expect(await total({ color: "verde" })).toBe(1);
    expect(await total({ color: "-" })).toBe(1);
    expect(await total({ color: "vermelho" })).toBe(0);

    // A step removed from the list stays on the lead until someone changes it.
    await anon(pool, "select lh_set_stages($1, $2) as r", [adminPanel, JSON.stringify(["Enviou material"])]);
    expect(await update(ws.token, { color: "" })).toMatchObject({ stage: "Visita marcada", color: null });
    expect(await update(ws.token, { stage: "" })).toMatchObject({ stage: null });

    const { history } = await anon<{ history: { type: string; to: string | null }[] }>(pool, "select lh_lead_detail($1, $2) as r", [ws.token, leadId]);
    expect(history.filter((h) => h.type === "stage").map((h) => h.to)).toEqual(expect.arrayContaining(["Visita marcada", null]));
    expect(history.filter((h) => h.type === "color").map((h) => h.to)).toEqual(expect.arrayContaining(["verde", null]));
    // Nothing of this is queued for Meta.
    expect((await pool.query("select count(*)::int n from lh_meta_events where lead_id = $1", [leadId])).rows[0].n).toBe(0);
  });
});
