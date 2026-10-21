import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createPool, setupAdmin, setupWorkspace, type Setup } from "./harness";

const CIPHER = "enc:v1:aXZpdml2aXZpdml2.dGFndGFndGFn.Y2lwaGVydGV4dA";

interface Summary {
  id: string;
}

describe("integrations opened from the sheet (team account)", () => {
  let pool: Pool;
  let master: { token: string };
  let client: Setup;
  let other: Setup;

  const open = (token: string) => anon<{ token: string; workspace_id: string }>(pool, "select lh_session_open_integrations($1) as r", [token]);

  beforeAll(async () => {
    pool = createPool();
    master = await setupAdmin(pool);
    client = await setupWorkspace(pool, "Loja da equipe");
    other = await setupWorkspace(pool, "Outro cliente");
  });
  afterAll(() => pool.end());

  it("stays closed until the master turns it on", async () => {
    expect(await anon(pool, "select lh_session($1) as r", [client.token])).toMatchObject({ configure: false });
    await expect(open(client.token)).rejects.toMatchObject({ code: "LH403" });
    await anon(pool, "select lh_admin_set_team_access($1, $2, true) as r", [master.token, client.workspaceId]);
    expect(await anon(pool, "select lh_session($1) as r", [client.token])).toMatchObject({ configure: true });
    expect(await anon(pool, "select lh_admin_get_team_access($1, $2) as r", [master.token, client.workspaceId])).toBe(true);
  });

  it("the team configures its client and nothing else", async () => {
    const team = await open(client.token);
    expect(team.workspace_id).toBe(client.workspaceId);
    const session = await anon<{ role: string; team: { id: string } }>(pool, "select lh_admin_session($1) as r", [team.token]);
    expect(session).toMatchObject({ role: "conta", team: { id: client.workspaceId } });
    expect((await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [team.token])).map((c) => c.id)).toEqual([
      client.workspaceId,
    ]);
    // Landing Page and Meta of its own client.
    await anon(pool, "select lh_admin_add_page($1, $2, 'LP nova', array['lp.loja.com.br']) as r", [team.token, client.workspaceId]);
    await anon(pool, "select lh_admin_set_meta($1, $2, '123456789012345', $3, 'XYZ9', null, true, true, true) as r", [
      team.token,
      client.workspaceId,
      CIPHER,
    ]);
    expect(await anon(pool, "select lh_admin_get_meta($1, $2) as r", [team.token, client.workspaceId])).toMatchObject({
      pixel_id: "123456789012345",
    });
    // Never another client.
    await expect(anon(pool, "select lh_admin_workspace($1, $2) as r", [team.token, other.workspaceId])).rejects.toMatchObject({
      code: "LH404",
    });
    await expect(
      anon(pool, "select lh_admin_add_page($1, $2, 'x', '{}') as r", [team.token, other.workspaceId]),
    ).rejects.toMatchObject({ code: "LH404" });
  });

  it("cannot change the attendant password, open the sheet as admin, give access or switch itself", async () => {
    const team = await open(client.token);
    for (const sql of [
      "select lh_admin_reset_password($1, $2) as r",
      "select lh_admin_open_workspace($1, $2) as r",
      "select lh_admin_list_members($1, $2) as r",
      "select lh_admin_set_team_access($1, $2, true) as r",
    ]) {
      await expect(anon(pool, sql, [team.token, client.workspaceId]), sql).rejects.toMatchObject({ code: "LH403" });
    }
    await expect(
      anon(pool, "select lh_admin_add_member($1, $2, 'alguem@loja.com') as r", [team.token, client.workspaceId]),
    ).rejects.toMatchObject({ code: "LH403" });
  });

  it("turning it off closes the integrations at once; the team account is not listed as a person", async () => {
    const team = await open(client.token);
    expect(await anon(pool, "select lh_admin_list_members($1, $2) as r", [master.token, client.workspaceId])).toEqual([]);
    await anon(pool, "select lh_admin_set_team_access($1, $2, false) as r", [master.token, client.workspaceId]);
    expect(await anon<Summary[]>(pool, "select lh_admin_list_workspaces($1) as r", [team.token])).toEqual([]);
    await expect(anon(pool, "select lh_admin_workspace($1, $2) as r", [team.token, client.workspaceId])).rejects.toMatchObject({
      code: "LH404",
    });
    await expect(open(client.token)).rejects.toMatchObject({ code: "LH403" });
  });

  it("nobody logs in as the team account", async () => {
    const { rows } = await pool.query("select login from lh_admins where team_workspace_id = $1", [client.workspaceId]);
    expect(rows).toHaveLength(1);
    expect(await anon(pool, "select lh_admin_login($1, '') as r", [rows[0].login])).toBeNull();
  });
});
