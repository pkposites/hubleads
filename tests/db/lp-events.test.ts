import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

describe("landing page events", () => {
  let pool: Pool;
  let ws: Setup;

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Eventos LP");
  });

  afterAll(() => pool.end());

  const fire = (visitor: string, event: string, extra: Record<string, unknown> = {}) =>
    collect(pool, ws.key, { type: "lp_event", visitor_id: visitor, data: { event, source: "pixel", ...extra } });

  it("shows each lead's commercial events and hides noise", async () => {
    await fire("ev-1", "Lead");
    await fire("ev-1", "PageView"); // noise if it ever gets through
    await collect(pool, ws.key, { type: "quiz_concluido", visitor_id: "ev-1" }); // old LeadHub.track format
    await fire("ev-1", "Lead"); // repeated: listed once
    const lead = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "ev-1" })).lead_id!;
    await fire("ev-1", "Schedule", { value: 200 });
    const other = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "ev-2" })).lead_id!;

    const map = await anon<Record<string, string[]>>(pool, "select lh_lead_lp_events($1, $2) as r", [ws.token, [lead, other]]);
    expect(map).toEqual({ [lead]: ["Lead", "quiz_concluido", "Schedule"] });

    const detail = await anon<{ lp_events: { event: string; source: string | null; value: unknown }[] }>(
      pool,
      "select lh_lead_detail($1, $2) as r",
      [ws.token, lead],
    );
    expect(detail.lp_events.map((e) => e.event)).toEqual(["Lead", "quiz_concluido", "Lead", "Schedule"]);
    expect(detail.lp_events.at(-1)).toMatchObject({ source: "pixel", value: 200 });
  });

  it("measures how many people fired each event and how many became leads and sales", async () => {
    const m = await setupWorkspace(pool, "Métricas eventos");
    const send = (visitor: string, event: string) =>
      collect(pool, m.key, { type: "lp_event", visitor_id: visitor, data: { event } });
    await send("m-1", "Lead");
    await send("m-1", "Lead");
    await send("m-2", "Lead");
    await send("m-3", "InitiateCheckout");
    await send("m-3", "scroll");
    const sold = (await collect(pool, m.key, { type: "whatsapp_click", visitor_id: "m-1" })).lead_id!;
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [m.token, sold, JSON.stringify({ status: "venda" })]);

    const rows = await anon<{ event: string; people: number; events: number; leads: number; sales: number }[]>(
      pool,
      "select lh_lp_event_metrics($1, null) as r",
      [m.token],
    );
    expect(rows).toEqual([
      { event: "Lead", people: 2, events: 3, leads: 1, sales: 1 },
      { event: "InitiateCheckout", people: 1, events: 1, leads: 0, sales: 0 },
    ]);
  });

  it("tells the admin which pixel the page uses", async () => {
    const admin = await setupAdmin(pool);
    await fire("px-1", "Contact", { pixel_id: "123456789012345" });
    await fire("px-2", "Contact", { pixel_id: "<script>" });
    const pixels = await anon<{ pixel_id: string }[]>(pool, "select lh_admin_lp_pixels($1, $2) as r", [admin.token, ws.workspaceId]);
    expect(pixels.map((p) => p.pixel_id)).toEqual(["123456789012345"]);
    await expect(anon(pool, "select lh_admin_lp_pixels($1, $2) as r", [ws.token, ws.workspaceId])).rejects.toBeTruthy();
  });

  it("does not show other clients' events", async () => {
    const intruder = await setupWorkspace(pool, "Outro cliente");
    const lead = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "ev-1" })).lead_id!;
    expect(await anon(pool, "select lh_lead_lp_events($1, $2) as r", [intruder.token, [lead]])).toEqual({});
    expect(await anon(pool, "select lh_lp_event_metrics($1, null) as r", [intruder.token])).toEqual([]);
  });
});
