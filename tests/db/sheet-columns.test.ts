import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, SERVER_SECRET, setupAdmin, setupWorkspace, type Setup } from "./harness";

describe("sheet columns (answers, added columns, standard ones)", () => {
  let pool: Pool;
  let ws: Setup;
  let adminPanel: string;
  const leadIds: string[] = [];

  const config = (token: string) =>
    anon<{ columns: { key: string; label: string; kind: string; hidden: boolean }[]; answers: { key: string; leads: number }[] }>(
      pool,
      "select lh_sheet_config($1) as r",
      [token],
    );
  const setColumns = (token: string, columns: unknown) => anon(pool, "select lh_set_sheet_columns($1, $2) as r", [token, JSON.stringify(columns)]);
  const update = (token: string, id: string, patch: unknown) =>
    anon<{ extra: Record<string, string> }>(pool, "select lh_update_lead($1, $2, $3) as r", [token, id, JSON.stringify(patch)]);

  beforeAll(async () => {
    pool = createPool();
    const admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Colunas");
    adminPanel = (await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, ws.workspaceId])).token;
    const source = await anon<{ id: string }>(pool, "select lh_admin_create_source($1, $2, 'sheets', 'Planilha') as r", [admin.token, ws.workspaceId]);
    for (const [i, faixa] of ["Até R$ 800 mil", "Até R$ 800 mil", "Acima de R$ 1 mi"].entries()) {
      const r = await anon<{ lead_id: string }>(pool, "select lh_server_source_lead($1, $2, $3) as r", [
        SERVER_SECRET,
        source.id,
        JSON.stringify({ external_id: `row:${i}`, name: `Lead ${i}`, answers: { "Qual a faixa?": faixa, ...(i === 0 && { Bairro: "Moema" }) } }),
      ]);
      leadIds.push(r.lead_id);
    }
  });
  afterAll(() => pool.end());

  it("lists the answers found in the client's leads", async () => {
    const c = await config(ws.token);
    expect(c.columns).toEqual([]);
    expect(c.answers).toEqual([
      { key: "Qual a faixa?", leads: 3 },
      { key: "Bairro", leads: 1 },
    ]);
  });

  it("only a panel admin saves the settings, and they are validated", async () => {
    const columns = [
      { key: "Qual a faixa?", label: "Faixa", kind: "answer", hidden: false },
      { key: "Bairro", label: "", kind: "answer", hidden: true },
      { key: "Renda", label: "Renda familiar", kind: "custom", hidden: false },
      { key: "page", label: "", kind: "fixed", hidden: true },
    ];
    await expect(setColumns(ws.token, columns)).rejects.toMatchObject({ code: "LH403" });
    await setColumns(adminPanel, columns);
    expect((await config(ws.token)).columns).toEqual(columns);

    for (const bad of [
      [{ key: "x", kind: "fixed", hidden: false }],
      [{ key: "", kind: "answer" }],
      [{ key: "whatsapp_url", kind: "answer" }],
      [{ key: "a", kind: "custom" }, { key: "a", kind: "answer" }],
      [{ key: "a", kind: "formula" }],
      { key: "a" },
    ]) {
      await expect(setColumns(adminPanel, bad)).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("attendants fill in only the added columns; changes go to the history", async () => {
    const lead = await update(ws.token, leadIds[0], { fields: { Renda: "  R$ 20 mil " } });
    expect(lead.extra).toMatchObject({ Renda: "R$ 20 mil", "Qual a faixa?": "Até R$ 800 mil" });
    await expect(update(ws.token, leadIds[0], { fields: { "Qual a faixa?": "outra" } })).rejects.toMatchObject({ code: "22023" });
    await expect(update(ws.token, leadIds[0], { fields: { Inexistente: "x" } })).rejects.toMatchObject({ code: "22023" });
    expect((await update(ws.token, leadIds[0], { fields: { Renda: "" } })).extra).not.toHaveProperty("Renda");

    const { history } = await anon<{ history: { type: string; from: string | null; to: string | null }[] }>(
      pool,
      "select lh_lead_detail($1, $2) as r",
      [ws.token, leadIds[0]],
    );
    const fields = history.filter((h) => h.type === "field").map((h) => [h.from, h.to]);
    expect(fields).toEqual(expect.arrayContaining([["Renda", "R$ 20 mil"], ["Renda", null]]));
    expect(history.find((h) => h.type === "created")?.to).toBe("Planilha");
  });

  it("counts leads, bookings and sales by answer", async () => {
    await update(ws.token, leadIds[2], { status: "venda", sale_value: 1000 });
    const rows = await anon<{ value: string; leads: number; sales: number; revenue: number }[]>(pool, "select lh_answer_metrics($1, $2) as r", [
      ws.token,
      "Qual a faixa?",
    ]);
    expect(rows).toMatchObject([
      { value: "Até R$ 800 mil", leads: 2, sales: 0 },
      { value: "Acima de R$ 1 mi", leads: 1, sales: 1, revenue: 1000 },
    ]);
    const other = await setupWorkspace(pool, "Outro");
    expect(await anon(pool, "select lh_answer_metrics($1, $2) as r", [other.token, "Qual a faixa?"])).toEqual([]);
    expect((await config(other.token)).answers).toEqual([]);
  });
});
