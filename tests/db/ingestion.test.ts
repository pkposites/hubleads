import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, createProject, createUser, createWorkspace, ingest } from "./harness";

// Blueprint §6.4, §8, §17.2 and AC04-AC06.
describe("lead ingestion", () => {
  let pool: Pool;
  let admin: string;
  let workspaceId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    pool = createPool();
    admin = await createUser(pool, "admin");
    ({ id: workspaceId } = await createWorkspace(pool, admin));
    projectId = await createProject(pool, admin, workspaceId, "Dra Letícia");
    otherProjectId = await createProject(pool, admin, workspaceId, "Dr João");
  });

  afterAll(() => pool.end());

  const lead = (n: number) => ({ name: `Lead ${n}`, phone: `11 97777-${n}`, phone_norm: `+55119777700${n}` });

  it("creates a lead in the first stage with history, answers and a lead.created event", async () => {
    const result = await ingest(pool, {
      project_id: projectId,
      lead: lead(10),
      answers: { budget_range: "10k_20k", city: "São Paulo" },
      touch: { channel: "meta_ads", utm_source: "facebook" },
    });
    expect(result).toMatchObject({ created: true, duplicate: false, replayed: false });

    const { rows } = await pool.query(
      `select l.source_channel, s.key as stage, l.first_touch ->> 'utm_source' as first_source,
              (select count(*) from public.lead_answers a where a.lead_id = l.id)::int as answers,
              (select count(*) from public.lead_stage_history h where h.lead_id = l.id)::int as history,
              (select event_type from public.outbox_events e where e.aggregate_id = l.id) as event
         from public.leads l join public.pipeline_stages s on s.id = l.current_stage_id
        where l.id = $1`,
      [result.lead_id],
    );
    expect(rows[0]).toEqual({
      source_channel: "meta_ads",
      stage: "new",
      first_source: "facebook",
      answers: 2,
      history: 1,
      event: "lead.created",
    });
  });

  it("returns the original result when the same request is replayed", async () => {
    const input = { project_id: projectId, idempotency_key: "idem-1", request_hash: "h1", lead: lead(11) };
    const first = await ingest(pool, input);
    const second = await ingest(pool, input);
    expect(second).toMatchObject({ lead_id: first.lead_id, conversion_id: first.conversion_id, replayed: true });
    const { rows } = await pool.query("select count(*)::int as n from public.lead_conversions where lead_id = $1", [
      first.lead_id,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects a reused idempotency key with a different payload", async () => {
    await ingest(pool, { project_id: projectId, idempotency_key: "idem-2", request_hash: "a", lead: lead(12) });
    await expect(
      ingest(pool, { project_id: projectId, idempotency_key: "idem-2", request_hash: "b", lead: lead(12) }),
    ).rejects.toMatchObject({ code: "LH409" });
  });

  it("creates exactly one conversion for concurrent submissions with the same key", async () => {
    const input = { project_id: projectId, idempotency_key: "idem-race", request_hash: "r", lead: lead(13) };
    const results = await Promise.all([ingest(pool, input), ingest(pool, input), ingest(pool, input)]);
    expect(new Set(results.map((r) => r.conversion_id)).size).toBe(1);
  });

  it("reuses the lead for the same phone and records a new conversion", async () => {
    const first = await ingest(pool, { project_id: projectId, lead: lead(14), touch: { channel: "google_ads" } });
    const second = await ingest(pool, {
      project_id: projectId,
      lead: { ...lead(14), email: "novo@example.com", email_norm: "novo@example.com" },
      touch: { channel: "meta_ads" },
    });
    expect(second).toMatchObject({ lead_id: first.lead_id, created: false, duplicate: true });

    const { rows } = await pool.query(
      `select email_norm, source_channel, last_touch ->> 'channel' as last_channel,
              (select count(*)::int from public.lead_conversions c where c.lead_id = l.id) as conversions
         from public.leads l where id = $1`,
      [first.lead_id],
    );
    // First touch is preserved, last touch moves, missing contact data is filled in.
    expect(rows[0]).toEqual({
      email_norm: "novo@example.com",
      source_channel: "google_ads",
      last_channel: "meta_ads",
      conversions: 2,
    });
  });

  it("does not merge the same phone across projects", async () => {
    const a = await ingest(pool, { project_id: projectId, lead: lead(15) });
    const b = await ingest(pool, { project_id: otherProjectId, lead: lead(15) });
    expect(b.lead_id).not.toBe(a.lead_id);
    expect(b.created).toBe(true);
  });

  it("reuses a lead by e-mail when no phone is given", async () => {
    const email = { email: "Maria@Example.com", email_norm: "maria@example.com" };
    const first = await ingest(pool, { project_id: projectId, lead: email });
    const second = await ingest(pool, { project_id: projectId, lead: email });
    expect(second.lead_id).toBe(first.lead_id);
  });

  it("flags a conflict when the e-mail belongs to a lead with another phone", async () => {
    const email = { email: "ana@example.com", email_norm: "ana@example.com" };
    const first = await ingest(pool, { project_id: projectId, lead: { ...lead(16), ...email } });
    const second = await ingest(pool, { project_id: projectId, lead: { ...lead(17), ...email } });
    expect(second.lead_id).not.toBe(first.lead_id);
    const { rows } = await pool.query("select needs_review from public.leads where id = $1", [second.lead_id]);
    expect(rows[0].needs_review).toBe(true);
  });

  it("creates one lead for concurrent submissions of the same phone", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => ingest(pool, { project_id: projectId, lead: lead(18) })),
    );
    expect(new Set(results.map((r) => r.lead_id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("rejects a submission without phone or e-mail", async () => {
    await expect(ingest(pool, { project_id: projectId, lead: { name: "Sem contato" } })).rejects.toThrow(
      /phone or e-mail/,
    );
  });

  it("rejects an archived or unknown project", async () => {
    await pool.query("update public.projects set status = 'archived' where id = $1", [otherProjectId]);
    await expect(ingest(pool, { project_id: otherProjectId, lead: lead(19) })).rejects.toMatchObject({
      code: "LH404",
    });
  });
});
