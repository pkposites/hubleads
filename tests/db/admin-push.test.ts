import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, collect, createPool, SERVER_SECRET, setupAdmin, uniqueSlug } from "./harness";

type Push = { company: string; workspace_id: string; targets: { kind: string; endpoint: string }[] };

describe("new-lead notifications on the admins' devices", () => {
  let pool: Pool;
  let master: { token: string };
  let gestor: { id: string; token: string };
  let other: { id: string; token: string };
  let gestorClient: { id: string; key: string; token: string };
  const device = () => `https://push.example.com/${randomUUID()}`;
  const subscribe = (token: string, endpoint: string) =>
    anon(pool, "select lh_admin_push_subscribe($1, $2, 'p256', 'auth') as r", [token, endpoint]);
  const pushFor = async (key: string) => {
    await collect(pool, key, { type: "whatsapp_click", visitor_id: randomUUID() });
    const lead = (await pool.query("select l.id from lh_leads l join lh_pages p on p.workspace_id = l.workspace_id where p.public_key = $1 order by l.created_at desc limit 1", [key])).rows[0].id;
    return anon<Push>(pool, "select lh_server_new_lead_push($1, $2) as r", [SERVER_SECRET, lead]);
  };
  const newGestor = async () => {
    const g = await anon<{ id: string; login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      master.token,
      `g-${randomUUID().slice(0, 8)}@example.com`,
    ]);
    const token = (await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [g.login, g.password])).token;
    return { id: g.id, token };
  };

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    gestor = await newGestor();
    other = await newGestor();
    const created = await anon<{ workspace: { id: string; pages: { public_key: string }[] }; password: string }>(
      pool,
      "select lh_admin_create_workspace($1, 'Cliente do Gestor', $2, 'LP', '{}') as r",
      [gestor.token, uniqueSlug("gestor")],
    );
    gestorClient = { id: created.workspace.id, key: created.workspace.pages[0].public_key, token: "" };
  });
  afterAll(() => pool.end());

  it("the master and the owning gestor are notified, with the client's name; other gestores are not", async () => {
    const m = device();
    const g = device();
    const o = device();
    await subscribe(master.token, m);
    await subscribe(gestor.token, g);
    await subscribe(other.token, o);
    const push = await pushFor(gestorClient.key);
    expect(push.company).toBe("Cliente do Gestor");
    expect(push.workspace_id).toBe(gestorClient.id);
    const endpoints = push.targets.map((t) => t.endpoint);
    expect(endpoints).toEqual(expect.arrayContaining([m, g]));
    expect(endpoints).not.toContain(o);
    expect(push.targets.filter((t) => [m, g].includes(t.endpoint)).every((t) => t.kind === "admin")).toBe(true);
  });

  it("a device linked to the client and to the admin gets one notice", async () => {
    const both = device();
    await subscribe(gestor.token, both);
    const opened = await anon<{ token: string }>(pool, "select lh_admin_open_workspace($1, $2) as r", [gestor.token, gestorClient.id]);
    await anon(pool, "select lh_push_subscribe($1, $2, 'p256', 'auth') as r", [opened.token, both]);
    const push = await pushFor(gestorClient.key);
    expect(push.targets.filter((t) => t.endpoint === both)).toEqual([expect.objectContaining({ kind: "admin" })]);
  });

  it("turning off, a disabled admin and a device that is gone stop the notices", async () => {
    const d = device();
    await subscribe(other.token, d);
    await anon(pool, "select lh_admin_push_unsubscribe($1, $2) as r", [other.token, d]);
    expect((await pool.query("select count(*)::int n from lh_admin_push_subscriptions where endpoint = $1", [d])).rows[0].n).toBe(0);

    const g2 = device();
    await subscribe(gestor.token, g2);
    await pool.query("update lh_admins set disabled_at = now() where id = $1", [gestor.id]);
    expect((await pushFor(gestorClient.key)).targets.map((t) => t.endpoint)).not.toContain(g2);
    await pool.query("update lh_admins set disabled_at = null where id = $1", [gestor.id]);

    await anon(pool, "select lh_server_push_gone($1, $2) as r", [SERVER_SECRET, g2]);
    expect((await pool.query("select count(*)::int n from lh_admin_push_subscriptions where endpoint = $1", [g2])).rows[0].n).toBe(0);
  });

  it("needs an admin session and a valid device; the table is closed", async () => {
    await expect(subscribe("invalido", device())).rejects.toMatchObject({ code: "LH401" });
    await expect(subscribe(master.token, "http://inseguro.example.com")).rejects.toMatchObject({ code: "22023" });
    await expect(anon(pool, "select count(*) as r from lh_admin_push_subscriptions")).rejects.toMatchObject({ code: "42501" });
  });
});
