import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, SERVER_SECRET, setupAdmin, setupWorkspace } from "./harness";

const data = { name: "Ana Souza", company: "Agência X", whatsapp: "11 91234-5678", email: "", profile: "agencia", channels: ["lp", "xss", "meta_form"], message: "" };

describe("sign-up requests from the home page", () => {
  let pool: Pool;
  let master: { token: string };
  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
  });
  afterAll(() => pool.end());

  const send = (client: string, d: Record<string, unknown> = data, secret = SERVER_SECRET) =>
    anon<{ ok?: boolean; limited?: boolean }>(pool, "select lh_server_signup($1, $2, $3) as r", [secret, client, JSON.stringify(d)]);

  it("stores a request only from the app's server, keeping known channels", async () => {
    const client = randomUUID();
    expect(await send(client)).toEqual({ ok: true });
    await expect(send(client, data, "errado")).rejects.toMatchObject({ code: "LH401" });
    await expect(send(client, { ...data, name: "" })).rejects.toMatchObject({ code: "22023" });
    const list = await anon<{ name: string; channels: string[]; client?: string }[]>(pool, "select lh_admin_list_signups($1) as r", [master.token]);
    const mine = list.find((s) => s.name === "Ana Souza")!;
    expect(mine.channels).toEqual(["lp", "meta_form"]);
    expect(mine).not.toHaveProperty("client");
    await expect(anon(pool, "select count(*) as r from lh_signups")).rejects.toMatchObject({ code: "42501" });
  });

  it("limits each device to 5 per hour", async () => {
    const client = randomUUID();
    for (let i = 0; i < 5; i++) expect(await send(client)).toEqual({ ok: true });
    expect(await send(client)).toEqual({ limited: true });
  });

  it("only the master sees and marks them", async () => {
    const ws = await setupWorkspace(pool, "Sem acesso");
    await expect(anon(pool, "select lh_admin_list_signups($1) as r", [ws.token])).rejects.toMatchObject({ code: "LH401" });
    const created = await anon<{ login: string; password: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [master.token, `g-${randomUUID().slice(0, 8)}@x.com`]);
    const gestor = await anon<{ token: string }>(pool, "select lh_admin_login($1, $2) as r", [created.login, created.password]);
    await expect(anon(pool, "select lh_admin_list_signups($1) as r", [gestor.token])).rejects.toMatchObject({ code: "LH403" });
    const [first] = await anon<{ id: string }[]>(pool, "select lh_admin_list_signups($1) as r", [master.token]);
    await anon(pool, "select lh_admin_mark_signup($1, $2, true) as r", [master.token, first.id]);
    const [after] = await anon<{ id: string; contacted_at: string | null }[]>(pool, "select lh_admin_list_signups($1) as r", [master.token]);
    expect(after.contacted_at).not.toBeNull();
  });
});
