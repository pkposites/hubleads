import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

describe("sheet: hidden metrics and the Meta id column", () => {
  let pool: Pool;
  let ws: Setup;
  let adminPanel: string;

  const config = (token: string) => anon<{ hidden_metrics: string[] }>(pool, "select lh_sheet_config($1) as r", [token]);
  const hide = (token: string, metrics: string[]) => anon<string[]>(pool, "select lh_set_hidden_metrics($1, $2) as r", [token, metrics]);

  beforeAll(async () => {
    pool = createPool();
    const admin = await setupAdmin(pool);
    ws = await setupWorkspace(pool, "Métricas");
    adminPanel = (await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [admin.token, ws.workspaceId])).token;
  });
  afterAll(() => pool.end());

  it("nothing is hidden at first; only a panel admin hides metrics, from the known list", async () => {
    expect((await config(ws.token)).hidden_metrics).toEqual([]);
    await expect(hide(ws.token, ["visitors"])).rejects.toMatchObject({ code: "LH403" });
    expect(await hide(adminPanel, ["visitors", "conversion", "visitors"])).toEqual(["conversion", "visitors"]);
    expect((await config(ws.token)).hidden_metrics).toEqual(["conversion", "visitors"]);
    await expect(hide(adminPanel, ["revenue"])).rejects.toMatchObject({ code: "22023" });
    expect(await hide(adminPanel, [])).toEqual([]);
  });

  it("the column settings save with the Meta id column", async () => {
    const columns = [{ key: "meta_ids", label: "", kind: "fixed", hidden: true }];
    expect(await anon(pool, "select lh_set_sheet_columns($1, $2) as r", [adminPanel, JSON.stringify(columns)])).toEqual(columns);
  });
});
