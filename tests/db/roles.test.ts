import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asUser,
  createPool,
  createProject,
  createUser,
  createWorkspace,
  ingest,
  stagesOf,
} from "./harness";

// Blueprint §4.3 permission matrix.
describe("roles inside a workspace", () => {
  let pool: Pool;
  let admin: string;
  let manager: string;
  let sales: string;
  let client: string;
  let agent: string;
  let workspaceId: string;
  let projectId: string;
  let stages: Record<string, string>;
  let assignedLead: string;
  let otherLead: string;

  beforeAll(async () => {
    pool = createPool();
    admin = await createUser(pool, "admin");
    [manager, sales, client, agent] = await Promise.all(
      ["manager", "sales", "client", "agent"].map((l) => createUser(pool, l)),
    );
    ({ id: workspaceId } = await createWorkspace(pool, admin));
    await addMember(pool, admin, workspaceId, manager, "manager");
    await addMember(pool, admin, workspaceId, sales, "sales");
    await addMember(pool, admin, workspaceId, client, "client");
    await addMember(pool, admin, workspaceId, agent, "agent");
    projectId = await createProject(pool, admin, workspaceId);
    stages = await stagesOf(pool, admin, projectId);
    ({ lead_id: assignedLead } = await ingest(pool, {
      project_id: projectId,
      lead: { phone: "11 98888-0001", phone_norm: "+5511988880001" },
    }));
    ({ lead_id: otherLead } = await ingest(pool, {
      project_id: projectId,
      lead: { phone: "11 98888-0002", phone_norm: "+5511988880002" },
    }));
    await asUser(pool, admin, (db) =>
      db.query("update public.leads set owner_id = $1 where id = $2", [agent, assignedLead]),
    );
  });

  afterAll(() => pool.end());

  const visibleLeads = (userId: string) =>
    asUser(pool, userId, async (db) =>
      (await db.query<{ id: string }>("select id from public.leads where project_id = $1", [projectId])).rows.map(
        (r) => r.id,
      ),
    );

  it("lets admin, manager, sales and client see every lead", async () => {
    for (const user of [admin, manager, sales, client]) {
      expect(await visibleLeads(user)).toHaveLength(2);
    }
  });

  it("shows an agent only the leads assigned to them", async () => {
    expect(await visibleLeads(agent)).toEqual([assignedLead]);
  });

  it("does not let a client move stages", async () => {
    await expect(
      asUser(pool, client, (db) => db.query("select public.move_lead_stage($1, $2)", [otherLead, stages.contacted])),
    ).rejects.toThrow(/lead not found/);
  });

  it("lets an agent move their own lead but not someone else's", async () => {
    await asUser(pool, agent, (db) =>
      db.query("select public.move_lead_stage($1, $2)", [assignedLead, stages.contacted]),
    );
    await expect(
      asUser(pool, agent, (db) => db.query("select public.move_lead_stage($1, $2)", [otherLead, stages.contacted])),
    ).rejects.toThrow(/lead not found/);
  });

  it("does not let an agent hand their lead to someone else", async () => {
    const updated = asUser(pool, agent, (db) =>
      db.query("update public.leads set owner_id = $1 where id = $2", [sales, assignedLead]),
    );
    await expect(updated).rejects.toThrow(/row-level security/);
  });

  it("only lets admins and managers see API keys and the outbox", async () => {
    await asUser(pool, admin, (db) =>
      db.query(
        "insert into public.project_api_keys (workspace_id, project_id, name, key_prefix, key_hash) values ($1, $2, 'k', 'sk_live_abcd', $3)",
        [workspaceId, projectId, "a".repeat(64)],
      ),
    );
    for (const [user, expected] of [
      [admin, 1],
      [manager, 1],
      [sales, 0],
      [client, 0],
      [agent, 0],
    ] as const) {
      const keys = await asUser(pool, user, async (db) =>
        (await db.query("select id from public.project_api_keys where project_id = $1", [projectId])).rowCount,
      );
      expect(keys).toBe(expected);
      const events = await asUser(pool, user, async (db) =>
        (await db.query("select id from public.outbox_events where project_id = $1", [projectId])).rowCount,
      );
      expect(events! > 0).toBe(expected === 1);
    }
  });

  it("only lets admins and managers create projects", async () => {
    await createProject(pool, manager, workspaceId);
    await expect(createProject(pool, sales, workspaceId)).rejects.toThrow(/row-level security/);
  });

  it("only lets admins manage members", async () => {
    const newcomer = await createUser(pool, "newcomer");
    await expect(addMember(pool, manager, workspaceId, newcomer, "sales")).rejects.toThrow(/row-level security/);
    await addMember(pool, admin, workspaceId, newcomer, "sales");
  });

  it("does not let members write normalized or pipeline fields on leads directly", async () => {
    await expect(
      asUser(pool, admin, (db) =>
        db.query("update public.leads set current_stage_id = $1 where id = $2", [stages.won, otherLead]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(pool, admin, (db) =>
        db.query("insert into public.leads (workspace_id, project_id) values ($1, $2)", [workspaceId, projectId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
