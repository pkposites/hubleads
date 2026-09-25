import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

const SECRET = "test-server-secret-0123456789abcdef";
const CIPHER = "enc:v1:aXZpdml2aXZpdml2.dGFndGFndGFn.Y2lwaGVydGV4dA";

describe("Meta retries and alerts", () => {
  let pool: Pool;
  let ws: Setup;
  let adminToken: string;

  beforeAll(async () => {
    pool = createPool();
    await pool.query("select lh_private.set_server_secret($1)", [SECRET]);
    ws = await setupWorkspace(pool, "Meta confiável");
    adminToken = (await setupAdmin(pool)).token;
  });
  afterAll(() => pool.end());

  const setMeta = (testCode: string | null, enabled = true) =>
    anon(pool, "select lh_admin_set_meta($1, $2, '123456789', $3, 'XYZ9', $4, $5, true, true) as r", [
      adminToken,
      ws.workspaceId,
      CIPHER,
      testCode,
      enabled,
    ]);
  const pending = () => anon<string[]>(pool, "select lh_server_meta_pending($1, 20) as r", [SECRET]);
  const log = (lead: string, event: string, ok: boolean, test = false) =>
    anon(pool, "select lh_server_meta_log($1, $2, $3, $4, 'id', $5, $6, 'resp') as r", [SECRET, ws.workspaceId, lead, event, ok, test]);
  const lead = async (visitor: string, patch: Record<string, unknown>) => {
    const id = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: visitor })).lead_id!;
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [ws.token, id, JSON.stringify(patch)]);
    return id;
  };

  it("lists owed conversions only in live mode, with consent, and gives the real status time", async () => {
    const booked = await lead("p-1", { status: "agendado" });
    const soldNoValue = await lead("p-2", { status: "venda" });
    const sold = await lead("p-3", { status: "venda", sale_value: 1500 });
    const refused = (await collect(pool, ws.key, { type: "whatsapp_click", visitor_id: "p-4", consent: false })).lead_id!;
    await anon(pool, "select lh_update_lead($1, $2, $3) as r", [ws.token, refused, JSON.stringify({ status: "agendado" })]);

    await setMeta("TEST1");
    expect(await pending()).toEqual([]);
    await setMeta(null);
    const owed = await pending();
    expect(owed).toEqual(expect.arrayContaining([booked, sold]));
    expect(owed).not.toContain(soldNoValue);
    expect(owed).not.toContain(refused);

    const payload = await anon<{ status_at: string }>(pool, "select lh_server_meta_payload($1, $2) as r", [SECRET, booked]);
    expect(Date.now() - new Date(payload.status_at).getTime()).toBeLessThan(60_000);
  });

  it("waits between attempts, gives up after 6 failures and stops once sent", async () => {
    const id = await lead("r-1", { status: "agendado" });
    await log(id, "Schedule", false);
    expect(await pending()).not.toContain(id); // tried less than 50 minutes ago
    await pool.query("update lh_meta_events set created_at = now() - interval '2 hours' where lead_id = $1", [id]);
    expect(await pending()).toContain(id);

    for (let i = 0; i < 5; i++) await log(id, "Schedule", false);
    await pool.query("update lh_meta_events set created_at = now() - interval '2 hours' where lead_id = $1", [id]);
    expect(await pending()).not.toContain(id); // 6 failures

    const other = await lead("r-2", { status: "agendado" });
    await log(other, "Schedule", true);
    await pool.query("update lh_meta_events set created_at = now() - interval '2 hours' where lead_id = $1", [other]);
    expect(await pending()).not.toContain(other);

    const history = await anon<{ history: { type: string; to: string }[] }>(pool, "select lh_lead_detail($1, $2) as r", [ws.token, id]);
    expect(history.history.filter((h) => h.type === "meta").map((h) => h.to)).toEqual(["Schedule falhou (nova tentativa automática)"]);
  });

  it("skips bookings older than 7 days, which Meta would refuse", async () => {
    const id = await lead("o-1", { status: "agendado" });
    await pool.query("update lh_lead_history set created_at = now() - interval '8 days' where lead_id = $1 and type = 'status'", [id]);
    expect(await pending()).not.toContain(id);
  });

  it("shows failures and the landing page's own Schedule/Purchase to the admin", async () => {
    await collect(pool, ws.key, { type: "lp_event", visitor_id: "c-1", data: { event: "Schedule", source: "pixel" } });
    await collect(pool, ws.key, { type: "lp_event", visitor_id: "c-1", data: { event: "Lead", source: "pixel" } });
    await collect(pool, ws.key, { type: "lp_event", visitor_id: "c-1", data: { event: "Purchase", source: "api" } });
    const meta = await anon<{ failures_24h: number; last_error: string; lp_conflicts: string[] }>(
      pool,
      "select lh_admin_get_meta($1, $2) as r",
      [adminToken, ws.workspaceId],
    );
    expect(meta.failures_24h).toBeGreaterThanOrEqual(6);
    expect(meta.last_error).toBe("resp");
    expect(meta.lp_conflicts).toEqual(["Schedule"]);
  });

  it("is only for the app's server", async () => {
    await expect(anon(pool, "select lh_server_meta_pending('errado', 20) as r")).rejects.toMatchObject({ code: "LH401" });
  });
});
