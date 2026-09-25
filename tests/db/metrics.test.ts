import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupWorkspace, type Setup } from "./harness";

interface Row {
  key: string;
  visitors: number;
  clickers: number;
  leads: number;
  with_phone: number;
  scheduled: number;
  sales: number;
  revenue: number;
}
interface Metrics {
  totals: Row & { clicks: number; manual_leads: number };
  rows: Row[];
  daily: { day: string; visitors: number; clickers: number }[];
}

describe("conversion metrics", () => {
  let pool: Pool;
  let ws: Setup;
  const adA = { utm_source: "facebook", campaign_name: "Implante", adset_name: "SP", ad_name: "Vídeo A" };
  const adB = { utm_source: "facebook", utm_campaign: "Implante", utm_term: "SP", utm_content: "Vídeo B" };

  const metrics = (dimension = "channel") =>
    anon<Metrics>(pool, "select lh_metrics($1, null, $2) as r", [ws.token, dimension]);

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool);
    // 4 visitors: 3 from ad A, 1 from ad B.
    for (const v of ["a1", "a2", "a3"]) {
      await collect(pool, ws.key, { type: "page_view", visitor_id: v, channel: "meta_ads", attribution: adA });
    }
    await collect(pool, ws.key, { type: "page_view", visitor_id: "b1", channel: "google_ads", attribution: adB });
    // a1 clicks twice with a phone, b1 clicks once without.
    const lead = await collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: "a1",
      channel: "meta_ads",
      phone: "+5511911110000",
      attribution: adA,
    });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "a1", channel: "meta_ads", attribution: adA });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "b1", channel: "google_ads", attribution: adB });
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [
      ws.token,
      lead.lead_id,
      JSON.stringify({ status: "venda", sale_value: "18000" }),
    ]);
    await anon(pool, "select lh_create_lead($1, 'Balcão', '+5511900000000') as r", [ws.token]);
  });

  afterAll(() => pool.end());

  it("counts people, not repeated clicks", async () => {
    const { totals } = await metrics();
    expect(totals).toMatchObject({
      visitors: 4,
      clickers: 2,
      clicks: 3,
      leads: 2,
      with_phone: 1,
      scheduled: 1,
      sales: 1,
      revenue: 18000,
      manual_leads: 1,
    });
  });

  it("breaks the funnel down by channel", async () => {
    const { rows } = await metrics("channel");
    expect(rows).toEqual([
      { key: "meta_ads", visitors: 3, clickers: 1, leads: 1, with_phone: 1, scheduled: 1, sales: 1, revenue: 18000 },
      { key: "google_ads", visitors: 1, clickers: 1, leads: 1, with_phone: 0, scheduled: 0, sales: 0, revenue: 0 },
    ]);
  });

  it("uses Meta names or their utm_* fallback for campaign, ad set and ad", async () => {
    expect((await metrics("campaign")).rows).toEqual([
      expect.objectContaining({ key: "Implante", visitors: 4, clickers: 2 }),
    ]);
    const ads = (await metrics("ad")).rows.map((r) => [r.key, r.visitors, r.clickers]);
    expect(ads).toEqual([
      ["Vídeo A", 3, 1],
      ["Vídeo B", 1, 1],
    ]);
  });

  it("returns a daily series", async () => {
    const { daily } = await metrics();
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ visitors: 4, clickers: 2 });
  });

  it("rejects an unknown breakdown and a missing session", async () => {
    await expect(metrics("utm_hack")).rejects.toMatchObject({ code: "22023" });
    await expect(anon(pool, "select lh_metrics('nope') as r")).rejects.toMatchObject({ code: "LH401" });
  });
});
