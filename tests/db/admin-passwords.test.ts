import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, setupAdmin } from "./harness";

const SECRET = "test-server-secret-0123456789abcdef";

describe("admins manage their own password", () => {
  let pool: Pool;

  const login = (l: string, p: string) => anon<{ token?: string } | null>(pool, "select lh_admin_login($1, $2) as r", [l, p]);
  const session = (t: string) => anon(pool, "select lh_admin_session($1) as r", [t]);
  const request = (l: string, secret = SECRET) =>
    anon<{ token: string; login: string } | null>(pool, "select lh_server_admin_reset_request($1, $2) as r", [secret, l]);
  const valid = (t: string) => anon<boolean>(pool, "select lh_server_admin_reset_valid($1, $2) as r", [SECRET, t]);
  const reset = (t: string, p: string) =>
    anon<{ login: string } | null>(pool, "select lh_server_admin_reset_password($1, $2, $3) as r", [SECRET, t, p]);
  const change = (t: string, current: string, next: string) =>
    anon<{ ok?: boolean; error?: string }>(pool, "select lh_admin_change_password($1, $2, $3) as r", [t, current, next]);

  beforeAll(async () => {
    pool = createPool();
    await pool.query("select lh_private.set_server_secret($1)", [SECRET]);
  });
  afterAll(() => pool.end());

  it("changes the password with the current one and ends the other sessions", async () => {
    const admin = await setupAdmin(pool);
    const other = (await login(admin.login, admin.password))!.token!;

    expect(await change(admin.token, "errada-123456", "nova-senha-123")).toEqual({ error: "wrong_password" });
    await expect(change(admin.token, admin.password, "curta")).rejects.toMatchObject({ code: "22023" });
    expect(await change(admin.token, admin.password, "nova-senha-123")).toEqual({ ok: true });

    expect(await session(admin.token)).toMatchObject({ login: admin.login });
    await expect(session(other)).rejects.toMatchObject({ code: "LH401" });
    expect(await login(admin.login, admin.password)).toBeNull();
    expect((await login(admin.login, "nova-senha-123"))?.token).toBeTruthy();
  });

  it("locks the change after repeated wrong current passwords", async () => {
    const admin = await setupAdmin(pool);
    for (let i = 0; i < 5; i++) await change(admin.token, `errada-${i}-0000`, "nova-senha-123");
    const locked = await change(admin.token, admin.password, "nova-senha-123");
    expect(locked).toMatchObject({ error: "locked" });
  });

  it("recovers access with a one-time link", async () => {
    const admin = await setupAdmin(pool);
    const first = (await request(admin.login.toUpperCase()))!;
    expect(first.login).toBe(admin.login);
    const second = (await request(admin.login))!;

    // Only the latest link works.
    expect(await valid(first.token)).toBe(false);
    expect(await reset(first.token, "senha-recuperada-1")).toBeNull();
    expect(await valid(second.token)).toBe(true);
    await expect(reset(second.token, "curta")).rejects.toMatchObject({ code: "22023" });

    expect(await reset(second.token, "senha-recuperada-1")).toEqual({ login: admin.login });
    await expect(session(admin.token)).rejects.toMatchObject({ code: "LH401" });
    expect(await reset(second.token, "outra-senha-9999")).toBeNull();
    expect(await valid(second.token)).toBe(false);
    expect((await login(admin.login, "senha-recuperada-1"))?.token).toBeTruthy();
  });

  it("expired links do not work", async () => {
    const admin = await setupAdmin(pool);
    const link = (await request(admin.login))!;
    await pool.query("update lh_private.admin_password_resets set expires_at = now() - interval '1 second' where used_at is null");
    expect(await valid(link.token)).toBe(false);
    expect(await reset(link.token, "senha-recuperada-1")).toBeNull();
  });

  it("answers null for unknown e-mails, deactivated gestores and after 3 links in an hour", async () => {
    const master = await setupAdmin(pool);
    expect(await request(`ninguem-${randomUUID().slice(0, 8)}@example.com`)).toBeNull();

    const gestor = await anon<{ id: string; login: string }>(pool, "select lh_admin_create_gestor($1, $2) as r", [
      master.token,
      `gestor-${randomUUID().slice(0, 8)}@agencia.com`,
    ]);
    const link = (await request(gestor.login))!;
    await anon(pool, "select lh_admin_deactivate_gestor($1, $2) as r", [master.token, gestor.id]);
    expect(await valid(link.token)).toBe(false);
    expect(await request(gestor.login)).toBeNull();

    const admin = await setupAdmin(pool);
    for (let i = 0; i < 3; i++) expect(await request(admin.login)).not.toBeNull();
    expect(await request(admin.login)).toBeNull();
  });

  it("only the app's server can ask for or use a link", async () => {
    const admin = await setupAdmin(pool);
    await expect(request(admin.login, "wrong-secret-0123456789abcdef0123")).rejects.toMatchObject({ code: "LH401" });
    await expect(
      anon(pool, "select lh_server_admin_reset_password($1, $2, $3) as r", ["x", "y", "senha-recuperada-1"]),
    ).rejects.toMatchObject({ code: "LH401" });
    await expect(anon(pool, "select count(*) as r from lh_private.admin_password_resets")).rejects.toMatchObject({ code: "42501" });
  });
});
