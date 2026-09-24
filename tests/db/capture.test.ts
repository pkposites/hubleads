import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, listLeads, setupWorkspace, type Setup } from "./harness";

describe("landing page capture", () => {
  let pool: Pool;
  let ws: Setup;

  const metaClick = {
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "transplante_sp",
    utm_content: "video_01",
    ad_id: "120210456789",
    fbclid: "IwAR3x",
    fbc: "fb.1.1727190000.IwAR3x",
    fbp: "fb.1.1727180000.987654",
    landing_url: "https://clinica.com.br/transplante?utm_source=facebook",
    first_seen_at: "2026-09-24T12:00:00Z",
  };

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool);
  });

  afterAll(() => pool.end());

  it("records page views without creating leads", async () => {
    const res = await collect(pool, ws.key, { type: "page_view", visitor_id: "v-view", url: "https://clinica.com.br/" });
    expect(res).toEqual({ ok: true });
    expect((await listLeads(pool, ws.token)).total).toBe(0);
  });

  it("turns a WhatsApp click into a row with the attribution and code", async () => {
    const res = await collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: "v-1",
      code: "7f3k",
      channel: "meta_ads",
      device: "mobile",
      attribution: metaClick,
    });
    expect(res).toMatchObject({ ok: true, code: "7F3K", new_lead: true });

    const { rows } = await listLeads(pool, ws.token);
    expect(rows[0]).toMatchObject({
      code: "7F3K",
      phone: null,
      status: "novo",
      channel: "meta_ads",
      utm_campaign: "transplante_sp",
      ad_id: "120210456789",
      fbc: "fb.1.1727190000.IwAR3x",
      clicks: 1,
      source: "lp",
    });
  });

  it("counts repeated clicks of the same visitor on the same row", async () => {
    const again = await collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: "v-1",
      code: "7F3K",
      channel: "google_ads",
      attribution: { utm_campaign: "outra" },
    });
    expect(again.new_lead).toBe(false);
    const { rows } = await listLeads(pool, ws.token, { search: "7F3K" });
    expect(rows).toHaveLength(1);
    // First attribution is kept.
    expect(rows[0]).toMatchObject({ clicks: 2, utm_campaign: "transplante_sp", channel: "meta_ads" });
  });

  it("generates a code when the page does not send one and keeps the name", async () => {
    const res = await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "v-2", name: "Maria" });
    expect(res.code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    const { rows } = await listLeads(pool, ws.token, { search: "Maria" });
    expect(rows[0].name).toBe("Maria");
  });

  it("fills the name later from an identify event", async () => {
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "v-3" });
    await collect(pool, ws.key, { type: "identify", visitor_id: "v-3", name: "João" });
    const { rows } = await listLeads(pool, ws.token, { search: "João" });
    expect(rows).toHaveLength(1);
  });

  it("links later events of a visitor to their row", async () => {
    await collect(pool, ws.key, { type: "scroll_75", visitor_id: "v-1", data: { percent: 75 } });
    const events = await anon<{ type: string; lead_id: string | null }[]>(pool, "select lh_list_events($1) as r", [ws.token]);
    expect(events[0]).toMatchObject({ type: "scroll_75" });
    expect(events[0].lead_id).not.toBeNull();
  });

  it("rejects an unknown key", async () => {
    await expect(collect(pool, "pk_nope", { type: "page_view", visitor_id: "x" })).rejects.toMatchObject({
      code: "LH401",
    });
  });

  it("only accepts the page's domains once they are set", async () => {
    await anon(pool, "select lh_update_page($1, $2, null, $3, null) as r", [
      ws.token,
      ws.pageId,
      ["clinica.com.br", "*.clinica.com.br"],
    ]);
    await collect(pool, ws.key, { type: "page_view", visitor_id: "d-1" }, "clinica.com.br");
    await collect(pool, ws.key, { type: "page_view", visitor_id: "d-1" }, "lp.clinica.com.br");
    await expect(collect(pool, ws.key, { type: "page_view", visitor_id: "d-1" }, "evil.com")).rejects.toMatchObject({
      code: "LH403",
    });
    await anon(pool, "select lh_update_page($1, $2, null, '{}', null) as r", [ws.token, ws.pageId]);
  });

  it("rejects oversized or incomplete events", async () => {
    await expect(collect(pool, ws.key, { type: "page_view" } as never)).rejects.toMatchObject({ code: "22023" });
    await expect(
      collect(pool, ws.key, { type: "page_view", visitor_id: "big", data: { blob: "x".repeat(20000) } }),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("exposes the tracker config without personal data", async () => {
    const config = await anon(pool, "select lh_page_config($1) as r", [ws.key]);
    expect(config).toEqual({ whatsapp_code: true });
  });

  it("stores the page answers on the row and merges later ones", async () => {
    await collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: "quiz-1",
      data: { tempo_de_queda: "5 anos", investimento: "R$ 10 mil" },
    });
    await collect(pool, ws.key, {
      type: "whatsapp_click",
      visitor_id: "quiz-1",
      data: { investimento: "R$ 20 mil", areas: "Coroa" },
    });
    const rows = await anon<{ rows: { visitor_id?: string; extra: Record<string, string>; clicks: number }[] }>(
      pool,
      "select lh_list_leads($1) as r",
      [ws.token],
    );
    const lead = rows.rows.find((r) => r.extra.tempo_de_queda);
    expect(lead).toMatchObject({
      clicks: 2,
      extra: { tempo_de_queda: "5 anos", investimento: "R$ 20 mil", areas: "Coroa" },
    });
    expect(lead?.visitor_id).toBeUndefined();
  });
});
