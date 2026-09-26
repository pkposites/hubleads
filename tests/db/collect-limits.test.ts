import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupWorkspace, type Setup } from "./harness";

describe("limits against mass sending", () => {
  let pool: Pool;
  let ws: Setup;

  const leads = async () =>
    (await pool.query("select count(*)::int n from lh_leads where workspace_id = $1", [ws.workspaceId])).rows[0].n as number;
  const click = (client: string, visitor = `v${randomUUID().slice(0, 12)}`) =>
    collect(pool, ws.key, { type: "whatsapp_click", visitor_id: visitor, channel: "direct" }, "clinica.com.br", client);

  beforeAll(async () => {
    pool = createPool();
    ws = await setupWorkspace(pool, "Limites");
  });
  afterAll(() => pool.end());

  it("stops a device after 20 clicks in a minute; other devices keep working", async () => {
    const attacker = `atk-${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await click(attacker));
    expect(results.filter((r) => r.limited)).toHaveLength(5);
    expect(await leads()).toBe(20);

    expect((await click(`real-${randomUUID()}`)).ok).toBe(true);
    expect(await leads()).toBe(21);
  });

  it("stops a device after 100 clicks in an hour", async () => {
    const device = `hour-${randomUUID()}`;
    // 5 earlier minutes with 20 clicks each.
    for (let m = 1; m <= 5; m++) {
      await pool.query(
        "insert into lh_private.collect_hits (client, bucket, minute, hits) values ($1, 'lead', date_trunc('minute', now()) - make_interval(mins => $2), 20)",
        [device, m * 5],
      );
    }
    expect((await click(device)).limited).toBe(true);
  });

  it("limits page views and visits too, but generously", async () => {
    const device = `pv-${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 125; i++) {
      results.push(await collect(pool, ws.key, { type: "page_view", visitor_id: `pv${i}xxxxx` }, "clinica.com.br", device));
    }
    expect(results.filter((r) => r.limited)).toHaveLength(5);

    const visitor = createHash("sha256").update("x").digest("hex");
    const visit = (client: string) =>
      anon<{ ok?: boolean; limited?: boolean }>(pool, "select lh_server_count_visit($1, $2, $3, 'clinica.com.br', $4, '{}') as r", [
        SERVER_SECRET,
        client,
        ws.key,
        visitor,
      ]);
    const other = `visit-${randomUUID()}`;
    const visits = [];
    for (let i = 0; i < 61; i++) visits.push(await visit(other));
    expect(visits.filter((r) => r.limited)).toHaveLength(1);
  });

  it("cannot be skipped: the original functions and the counters are not public", async () => {
    await expect(
      anon(pool, "select lh_collect($1, 'clinica.com.br', '{\"type\":\"whatsapp_click\",\"visitor_id\":\"abcdefgh\"}') as r", [ws.key]),
    ).rejects.toMatchObject({ code: "42883" });
    await expect(anon(pool, "select lh_count_visit($1, 'clinica.com.br', repeat('a', 64), '{}') as r", [ws.key])).rejects.toMatchObject({
      code: "42883",
    });
    await expect(
      anon(pool, "select lh_server_collect('segredo-errado-0123456789abcdefghij', 'x', $1, 'clinica.com.br', '{}') as r", [ws.key]),
    ).rejects.toMatchObject({ code: "LH401" });
    await expect(anon(pool, "select count(*) as r from lh_private.collect_hits")).rejects.toMatchObject({ code: "42501" });
  });

  it("forgets the counters after two hours", async () => {
    await pool.query("insert into lh_private.collect_hits (client, bucket, minute, hits) values ('velho', 'lead', now() - interval '3 hours', 5)");
    await click(`limpa-${randomUUID()}`);
    expect((await pool.query("select count(*)::int n from lh_private.collect_hits where client = 'velho'")).rows[0].n).toBe(0);
  });
});
