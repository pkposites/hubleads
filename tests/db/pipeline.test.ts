import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

// Blueprint §9 and AC08/AC09.
describe("pipeline and stage changes", () => {
  let pool: Pool;
  let admin: string;
  let sales: string;
  let projectId: string;
  let stages: Record<string, string>;
  let leadId: string;
  let n = 0;

  const move = (user: string, stage: string, reason?: string, value?: number) =>
    asUser(pool, user, async (db) =>
      (
        await db.query("select * from leadhub.move_lead_stage($1, $2, $3, $4)", [
          leadId,
          stage,
          reason ?? null,
          value ?? null,
        ])
      ).rows[0],
    );

  beforeAll(async () => {
    pool = createPool();
    admin = await createUser(pool, "admin");
    sales = await createUser(pool, "sales");
    const { id: workspaceId } = await createWorkspace(pool, admin);
    await addMember(pool, admin, workspaceId, sales, "sales");
    projectId = await createProject(pool, admin, workspaceId);
    stages = await stagesOf(pool, admin, projectId);
  });

  beforeEach(async () => {
    n += 1;
    ({ lead_id: leadId } = await ingest(pool, {
      project_id: projectId,
      lead: { phone_norm: `+55119666600${n}` },
    }));
  });

  afterAll(() => pool.end());

  it("creates the default pipeline for every project", () => {
    expect(Object.keys(stages)).toEqual(["new", "contacted", "qualified", "scheduled", "won", "lost"]);
  });

  it("records author, from, to and time in the history", async () => {
    const history = await move(sales, stages.contacted);
    expect(history).toMatchObject({
      lead_id: leadId,
      from_stage_id: stages.new,
      to_stage_id: stages.contacted,
      changed_by: sales,
    });
    expect(history.created_at).toBeInstanceOf(Date);
  });

  it("does not create an outbox event for stages without one", async () => {
    await move(sales, stages.contacted);
    const { rows } = await pool.query(
      "select event_type from leadhub.outbox_events where aggregate_id = $1 order by created_at",
      [leadId],
    );
    expect(rows.map((r) => r.event_type)).toEqual(["lead.created"]);
  });

  it("enqueues the canonical event in the same transaction", async () => {
    const history = await move(sales, stages.qualified);
    const { rows } = await pool.query(
      "select event_key, status, payload from leadhub.outbox_events where event_type = 'lead.qualified' and aggregate_id = $1",
      [leadId],
    );
    expect(rows).toEqual([
      {
        event_key: `lead.qualified:${history.id}`,
        status: "pending",
        payload: expect.objectContaining({ lead_id: leadId, stage: "qualified" }),
      },
    ]);
  });

  it("stores the sale value and a stable transaction id on a win", async () => {
    const history = await move(sales, stages.won, undefined, 18000);
    const { rows } = await pool.query(
      "select l.sale_value, e.payload from leadhub.leads l join leadhub.outbox_events e on e.aggregate_id = l.id and e.event_type = 'lead.won' where l.id = $1",
      [leadId],
    );
    expect(rows[0].sale_value).toBe("18000.00");
    expect(rows[0].payload).toMatchObject({ sale_value: 18000, currency: "BRL", transaction_id: history.id });
  });

  it("requires a reason to mark a lead as lost", async () => {
    await expect(move(sales, stages.lost)).rejects.toThrow(/lost_reason is required/);
    await expect(move(sales, stages.lost, "   ")).rejects.toThrow(/lost_reason is required/);
    await move(sales, stages.lost, "Sem orçamento");
    const { rows } = await pool.query("select lost_reason from leadhub.leads where id = $1", [leadId]);
    expect(rows[0].lost_reason).toBe("Sem orçamento");
  });

  it("allows reopening a lost lead and keeps the whole history", async () => {
    await move(sales, stages.lost, "Não respondeu");
    await move(sales, stages.contacted);
    const { rows } = await pool.query(
      "select s.key from leadhub.lead_stage_history h join leadhub.pipeline_stages s on s.id = h.to_stage_id where h.lead_id = $1 order by h.created_at",
      [leadId],
    );
    expect(rows.map((r) => r.key)).toEqual(["new", "lost", "contacted"]);
    const lead = await pool.query("select lost_reason from leadhub.leads where id = $1", [leadId]);
    expect(lead.rows[0].lost_reason).toBeNull();
  });

  it("rejects a stage from another project", async () => {
    const otherProject = await createProject(pool, admin, (await pool.query("select workspace_id from leadhub.projects where id = $1", [projectId])).rows[0].workspace_id);
    const otherStages = await stagesOf(pool, admin, otherProject);
    await expect(move(sales, otherStages.contacted)).rejects.toThrow(/stage not found/);
  });

  it("rejects moving to the current stage", async () => {
    await expect(move(sales, stages.new)).rejects.toThrow(/already in this stage/);
  });

  it("keeps the history append-only", async () => {
    await move(sales, stages.contacted);
    for (const sql of [
      "update leadhub.lead_stage_history set to_stage_id = null where lead_id = $1",
      "delete from leadhub.lead_stage_history where lead_id = $1",
    ]) {
      await expect(asUser(pool, admin, (db) => db.query(sql, [leadId]))).rejects.toThrow(/permission denied/);
    }
  });
});
