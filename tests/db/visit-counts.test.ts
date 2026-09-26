import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupWorkspace, type Setup } from "./harness";

interface Metrics {
  totals: { visitors: number; clickers: number; leads: number };
  rows: { key: string; visitors: number; clickers: number }[];
  daily: { day: string; visitors: number; clickers: number }[];
}

const client = (who: string) => createHash("sha256").update(who).digest("hex");
const meta = { channel: "meta_ads", campaign: "Gestantes", adset: "SP", ad: "Vídeo 1", device: "mobile" };

describe("anonymous visit counts", () => {
  let pool: Pool;
  let ws: Setup;

  const count = (who: string, dims: Record<string, string> = meta, host = "clinica.com.br", key = ws.key) =>
    anon(pool, "select lh_server_count_visit($1, $2, $3, $4, $5, $6) as r", [
      SERVER_SECRET,
      randomUUID(),
      key,
      host,
      client(who),
      JSON.stringify(dims),
    ]);
  const metrics = (dimension = "channel") => anon<Metrics>(pool, "select lh_metrics($1, null, $2) as r", [ws.token, dimension]);
  const stats = () => anon<{ visitors: number; clicks: number }>(pool, "select lh_stats($1, null) as r", [ws.token]);

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Andressa");
  });
  afterAll(() => pool.end());

  it("counts each person once a day, with the views apart", async () => {
    await count("ana");
    await count("ana");
    await count("bia");
    await count("caio", { ...meta, channel: "google_organic", campaign: "", adset: "", ad: "" });
    const { rows } = await pool.query(
      "select channel, sum(visitors)::int visitors, sum(views)::int views from lh_visit_stats where workspace_id = $1 group by 1 order by 1",
      [ws.workspaceId],
    );
    expect(rows).toEqual([
      { channel: "google_organic", visitors: 1, views: 1 },
      { channel: "meta_ads", visitors: 2, views: 3 },
    ]);
  });

  it("uses the anonymous count for visitors, so people without consent count too", async () => {
    // Only one of the three accepted cookies (page_view); two clicked.
    await collect(pool, ws.key, { type: "page_view", visitor_id: "consentiu1", channel: "meta_ads", attribution: { campaign_name: "Gestantes" } });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "consentiu1", channel: "meta_ads", attribution: { campaign_name: "Gestantes" } });
    await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "recusou01", channel: "sem_consentimento", consent: false });

    const m = await metrics();
    expect(m.totals.visitors).toBe(3);
    expect(m.totals.clickers).toBe(2);
    expect(m.daily).toHaveLength(1);
    expect(m.daily[0]).toMatchObject({ visitors: 3, clickers: 2 });
    expect(m.rows.find((r) => r.key === "meta_ads")).toMatchObject({ visitors: 2, clickers: 1 });
    expect(m.rows.find((r) => r.key === "google_organic")).toMatchObject({ visitors: 1, clickers: 0 });
    expect((await metrics("campaign")).rows.find((r) => r.key === "Gestantes")?.visitors).toBe(2);
    expect(await stats()).toMatchObject({ visitors: 3, clicks: 2 });
  });

  it("falls back to the people with consent on days without anonymous counts", async () => {
    const old = await setupWorkspace(pool, "Antigo");
    for (const v of ["v1", "v2"]) await collect(pool, old.key, { type: "page_view", visitor_id: v, channel: "direct" });
    const m = await anon<Metrics>(pool, "select lh_metrics($1, null, 'channel') as r", [old.token]);
    expect(m.totals.visitors).toBe(2);
    expect(m.rows.find((r) => r.key === "direct")?.visitors).toBe(2);
  });

  it("keeps salts and hashes only for two days, and never the client value", async () => {
    await pool.query("insert into lh_private.visit_seen (page_id, day, hash) values ($1, current_date - 5, 'x')", [ws.pageId]);
    await pool.query("insert into lh_private.visit_salts (day, salt) values (current_date - 5, 'x') on conflict do nothing");
    await count("dani");
    const seen = await pool.query("select hash from lh_private.visit_seen where page_id = $1", [ws.pageId]);
    expect(seen.rows.map((r) => r.hash)).not.toContain(client("dani"));
    expect(seen.rows.map((r) => r.hash)).not.toContain("x");
    expect((await pool.query("select count(*)::int n from lh_private.visit_salts where day < current_date - 1")).rows[0].n).toBe(0);
  });

  it("checks the page key, the domain and the client format", async () => {
    await expect(count("eva", meta, "clinica.com.br", "pk_nao_existe")).rejects.toMatchObject({ code: "LH401" });
    await pool.query("update lh_pages set domains = '{clinica.com.br}' where id = $1", [ws.pageId]);
    await expect(count("eva", meta, "outro.com")).rejects.toMatchObject({ code: "LH403" });
    await expect(
      anon(pool, "select lh_server_count_visit($1, 'x', $2, 'clinica.com.br', '200.1.2.3', '{}') as r", [SERVER_SECRET, ws.key]),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(anon(pool, "select count(*) as r from lh_visit_stats")).rejects.toMatchObject({ code: "42501" });
  });
});
