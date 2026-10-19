import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collect, createPool, setupWorkspace, type Setup } from "./harness";

describe("landing pages with a form instead of WhatsApp", () => {
  let pool: Pool;
  let ws: Setup;
  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Formulário");
  });
  afterAll(() => pool.end());

  it("a form sent creates the lead, with the typed contact, and a second send updates it", async () => {
    const first = await collect(pool, ws.key, {
      type: "form_submit",
      visitor_id: "form-1",
      name: "Bia",
      phone: "+5511988887777",
      attribution: { utm_source: "facebook", utm_campaign: "Mentoria" },
      data: { via: "formulario", email: "bia@x.com" },
    });
    expect(first).toMatchObject({ ok: true, new_lead: true });
    expect(first.code).toMatch(/^[0-9A-Z]{4,8}$/);
    const again = await collect(pool, ws.key, { type: "form_submit", visitor_id: "form-1", phone: "+5511988887777" });
    expect(again.new_lead).toBe(false);
    const { rows } = await pool.query("select name, phone, utm_campaign, clicks, extra from lh_leads where workspace_id = $1", [ws.workspaceId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Bia", phone: "+5511988887777", utm_campaign: "Mentoria", clicks: 2 });
    expect(rows[0].extra).toMatchObject({ email: "bia@x.com" });
  });
});
