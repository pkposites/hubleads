import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asAnon,
  asUser,
  createPool,
  createProject,
  createUser,
  createWorkspace,
  ingest,
  uniqueSlug,
} from "./harness";

// Blueprint §20.1 / AC11: a member of workspace A cannot read or write
// anything that belongs to workspace B.
describe("workspace isolation", () => {
  let pool: Pool;
  let alice: string;
  let bob: string;
  let wsA: { id: string };
  let wsB: { id: string };
  let projectA: string;
  let projectB: string;
  let leadB: string;

  beforeAll(async () => {
    pool = createPool();
    alice = await createUser(pool, "alice");
    bob = await createUser(pool, "bob");
    wsA = await createWorkspace(pool, alice, "Clínica A");
    wsB = await createWorkspace(pool, bob, "Clínica B");
    projectA = await createProject(pool, alice, wsA.id);
    projectB = await createProject(pool, bob, wsB.id);
    ({ lead_id: leadB } = await ingest(pool, {
      project_id: projectB,
      lead: { name: "Lead B", phone: "+5511999990000", phone_norm: "+5511999990000" },
    }));
  });

  afterAll(() => pool.end());

  it("makes the creator an admin of the new workspace", async () => {
    const rows = await asUser(pool, alice, async (db) =>
      (await db.query("select role from public.workspace_members where workspace_id = $1", [wsA.id])).rows,
    );
    expect(rows).toEqual([{ role: "admin" }]);
  });

  it("only lists the caller's own workspaces", async () => {
    const ids = await asUser(pool, alice, async (db) =>
      (await db.query<{ id: string }>("select id from public.workspaces")).rows.map((r) => r.id),
    );
    expect(ids).toContain(wsA.id);
    expect(ids).not.toContain(wsB.id);
  });

  it.each([
    ["workspaces", "id"],
    ["workspace_members", "workspace_id"],
    ["projects", "workspace_id"],
    ["pipelines", "workspace_id"],
    ["pipeline_stages", "workspace_id"],
    ["leads", "workspace_id"],
    ["lead_conversions", "workspace_id"],
    ["lead_answers", "workspace_id"],
    ["lead_stage_history", "workspace_id"],
    ["outbox_events", "workspace_id"],
    ["landing_pages", "workspace_id"],
    ["forms", "workspace_id"],
    ["project_api_keys", "workspace_id"],
  ])("hides %s rows of another workspace", async (table, column) => {
    const count = await asUser(pool, alice, async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from public.${table} where ${column} = $1`,
        [wsB.id],
      );
      return Number(rows[0].n);
    });
    expect(count).toBe(0);
  });

  it("does not let a member read another workspace's lead by id", async () => {
    const rows = await asUser(pool, alice, async (db) =>
      (await db.query("select id from public.leads where id = $1", [leadB])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("does not let a member update another workspace's lead", async () => {
    const updated = await asUser(pool, alice, async (db) =>
      (await db.query("update public.leads set name = 'hacked' where id = $1", [leadB])).rowCount,
    );
    expect(updated).toBe(0);
    const { rows } = await pool.query("select name from public.leads where id = $1", [leadB]);
    expect(rows[0].name).toBe("Lead B");
  });

  it("does not let a member create projects in another workspace", async () => {
    await expect(
      asUser(pool, alice, (db) =>
        db.query("insert into public.projects (workspace_id, name, slug) values ($1, 'x', $2)", [
          wsB.id,
          uniqueSlug("prj"),
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a member add themselves to another workspace", async () => {
    await expect(
      asUser(pool, alice, (db) =>
        db.query("insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')", [
          wsB.id,
          alice,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let a member attach configuration to another workspace's project", async () => {
    // RLS passes (workspace A) but the composite FK pins the project to A.
    await expect(
      asUser(pool, alice, (db) =>
        db.query(
          "insert into public.landing_pages (workspace_id, project_id, name, domains) values ($1, $2, 'lp', '{x.com}')",
          [wsA.id, projectB],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("reports another workspace's lead as not found when moving its stage", async () => {
    const stageA = await asUser(pool, alice, async (db) =>
      (await db.query<{ id: string }>("select id from public.pipeline_stages where project_id = $1 limit 1", [projectA]))
        .rows[0].id,
    );
    await expect(
      asUser(pool, alice, (db) => db.query("select public.move_lead_stage($1, $2)", [leadB, stageA])),
    ).rejects.toThrow(/lead not found/);
  });

  it("gives anonymous callers nothing", async () => {
    await expect(asAnon(pool, (db) => db.query("select * from public.leads"))).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(pool, (db) => db.query("select public.create_workspace('x', $1)", [uniqueSlug("ws")])),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps ingestion out of reach of browser roles", async () => {
    const payload = JSON.stringify({ project_id: projectA, lead: { phone_norm: "+5511911112222" } });
    for (const run of [
      (sql: string) => asAnon(pool, (db) => db.query(sql, [payload])),
      (sql: string) => asUser(pool, alice, (db) => db.query(sql, [payload])),
    ]) {
      await expect(run("select public.ingest_lead_conversion($1)")).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses to remove the last admin", async () => {
    await expect(
      asUser(pool, alice, (db) =>
        db.query("delete from public.workspace_members where workspace_id = $1 and user_id = $2", [wsA.id, alice]),
      ),
    ).rejects.toThrow(/at least one admin/);
  });

  it("lets co-members see each other's profile but not strangers'", async () => {
    const carol = await createUser(pool, "carol");
    await addMember(pool, alice, wsA.id, carol, "sales");
    const visible = await asUser(pool, carol, async (db) =>
      (await db.query<{ id: string }>("select id from public.profiles")).rows.map((r) => r.id),
    );
    expect(visible).toEqual(expect.arrayContaining([alice, carol]));
    expect(visible).not.toContain(bob);
  });
});
