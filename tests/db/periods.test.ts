import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupWorkspace, type Setup } from "./harness";

// Two months of data: 2 people in August (1 clicked, 1 sale), 3 in September
// (2 clicked). Periods are whole days in America/Sao_Paulo (UTC-3).
const AUG = "2026-08-10T15:00:00Z";
const SEP = "2026-09-10T15:00:00Z";
const AUG_START = "2026-08-01T03:00:00Z";
const SEP_START = "2026-09-01T03:00:00Z";
const OCT_START = "2026-10-01T03:00:00Z";

describe("periods with a start and an end", () => {
  let pool: Pool;
  let ws: Setup;

  const stats = (since: string | null, until: string | null) =>
    anon<{ visitors: number; clicks: number; leads: number; sales: number }>(pool, "select lh_stats($1, $2, $3) as r", [ws.token, since, until]);

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Períodos");
    const people: [string, string, boolean][] = [
      ["ago1xxxxxx", AUG, true],
      ["ago2xxxxxx", AUG, false],
      ["set1xxxxxx", SEP, true],
      ["set2xxxxxx", SEP, true],
      ["set3xxxxxx", SEP, false],
    ];
    for (const [visitor, at, clicked] of people) {
      await collect(pool, ws.key, { type: "page_view", visitor_id: visitor, channel: "meta_ads" });
      if (clicked) await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: visitor, channel: "meta_ads" });
      await pool.query("update lh_events set created_at = $1 where visitor_id = $2", [at, visitor]);
      await pool.query("update lh_leads set created_at = $1 where visitor_id = $2", [at, visitor]);
    }
    await pool.query("update lh_leads set status = 'venda', sale_value = 500 where visitor_id = 'ago1xxxxxx'");
    // Anonymous counts: more people than those who accepted cookies.
    await pool.query(
      `insert into lh_visit_stats (workspace_id, page_id, day, channel, visitors, views)
       values ($1, $2, '2026-08-10', 'meta_ads', 4, 5), ($1, $2, '2026-09-10', 'meta_ads', 10, 12)`,
      [ws.workspaceId, ws.pageId],
    );
  });
  afterAll(() => pool.end());

  it("counts only inside the period, for events, leads and anonymous visits", async () => {
    expect(await stats(AUG_START, SEP_START)).toMatchObject({ visitors: 4, clicks: 1, leads: 1, sales: 1 });
    expect(await stats(SEP_START, OCT_START)).toMatchObject({ visitors: 10, clicks: 2, leads: 2, sales: 0 });
    expect(await stats(null, null)).toMatchObject({ visitors: 14, clicks: 3, leads: 3 });
    // Calls without the end keep working (older app version).
    expect(await anon(pool, "select lh_stats($1, $2) as r", [ws.token, SEP_START])).toMatchObject({ visitors: 10, leads: 2 });
  });

  it("the sheet, the metrics and the other panels follow the same period", async () => {
    const list = await anon<{ total: number }>(
      pool,
      "select lh_list_leads(p_token => $1, p_since => $2, p_until => $3) as r",
      [ws.token, AUG_START, SEP_START],
    );
    expect(list.total).toBe(1);

    const m = await anon<{ totals: { visitors: number; clickers: number; sales: number; revenue: number }; daily: { day: string }[] }>(
      pool,
      "select lh_metrics(p_token => $1, p_since => $2, p_until => $3) as r",
      [ws.token, AUG_START, SEP_START],
    );
    expect(m.totals).toMatchObject({ visitors: 4, clickers: 1, sales: 1, revenue: 500 });
    expect(m.daily.map((d) => d.day)).toEqual(["2026-08-10"]);

    const attendance = await anon<{ contacted: number }>(pool, "select lh_attendance_metrics($1, $2, $3) as r", [ws.token, SEP_START, OCT_START]);
    expect(attendance).toHaveProperty("contacted");
    const lp = await anon<unknown[]>(pool, "select lh_lp_event_metrics($1, $2, $3) as r", [ws.token, AUG_START, SEP_START]);
    expect(Array.isArray(lp)).toBe(true);
  });
});
