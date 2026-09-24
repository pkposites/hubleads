import { describe, expect, it } from "vitest";
import { createDemoClient, type OpStore } from "@/lib/demo/client";
import { DEMO_USER_ID } from "@/lib/demo/seed";
import { decodeOps, encodeOps, type DemoOp } from "@/lib/demo/state";

const NOW = new Date("2026-09-24T12:00:00Z");

/** Mimics the cookie: every save is serialised and read back by the next client. */
function memoryStore() {
  let value: string | undefined;
  const store: OpStore = {
    async load() {
      return decodeOps(value);
    },
    async save(ops) {
      value = encodeOps(ops);
    },
  };
  return { store, next: () => createDemoClient(store, () => NOW), size: () => value?.length ?? 0 };
}

type Any = Record<string, never> & Record<string, unknown>;

describe("demo client queries", () => {
  const { next } = memoryStore();

  it("lists the workspace's leads newest first with an exact count and paging", async () => {
    const res = await next()
      .from("leads")
      .select("*", { count: "exact" })
      .eq("workspace_id", "ws-exen")
      .order("created_at", { ascending: false })
      .range(0, 4);
    const rows = res.data as Any[];
    expect(res.count).toBe(12);
    expect(rows).toHaveLength(5);
    expect(rows[0].name).toBe("Thiago Ribeiro");
    expect(rows.map((r) => r.created_at)).toEqual([...rows.map((r) => r.created_at)].sort().reverse());
  });

  it("supports the leads search filter", async () => {
    const res = await next()
      .from("leads")
      .select("id, name")
      .or('name.ilike."*mariana*",email_norm.ilike."*mariana*",phone_norm.like."*9999*"');
    expect((res.data as Any[]).map((r) => r.name)).toEqual(["Mariana Costa"]);
  });

  it("filters by stage ids and embeds related rows", async () => {
    const lost = await next().from("leads").select("name").in("current_stage_id", ["prj-leticia:lost", "prj-joao:lost"]);
    expect((lost.data as Any[]).map((r) => r.name).sort()).toEqual(["Carlos Henrique Souza", "Renata Carvalho"]);

    const members = await next().from("workspace_members").select("role, workspaces (id, name, slug)").eq("user_id", DEMO_USER_ID);
    expect(members.data).toEqual([{ role: "admin", workspaces: { id: "ws-exen", name: "Clínica Exen", slug: "clinica-exen" } }]);
  });

  it("returns single rows and errors like PostgREST", async () => {
    const one = await next().from("workspaces").select("id, name").eq("slug", "clinica-exen").maybeSingle();
    expect(one).toMatchObject({ data: { id: "ws-exen", name: "Clínica Exen" }, error: null });
    const none = await next().from("workspaces").select("id").eq("slug", "nope").maybeSingle();
    expect(none).toMatchObject({ data: null, error: null });
    const many = await next().from("leads").select("id").single();
    expect(many.error?.code).toBe("PGRST116");
  });

  it("answers auth with the demo user", async () => {
    const { data } = await next().auth.getClaims();
    expect(data.claims.sub).toBe(DEMO_USER_ID);
  });
});

describe("demo client changes", () => {
  it("moves a lead, records history and keeps it for the next request", async () => {
    const { next } = memoryStore();
    const moved = await next().rpc("move_lead_stage", {
      p_lead_id: "lead-6",
      p_to_stage_id: "prj-leticia:contacted",
      p_lost_reason: null,
      p_sale_value: null,
    });
    expect(moved.error).toBeNull();

    const later = next();
    const lead = await later.from("leads").select("current_stage_id").eq("id", "lead-6").single();
    expect((lead.data as Any).current_stage_id).toBe("prj-leticia:contacted");
    const history = await later.from("lead_stage_history").select("*").eq("lead_id", "lead-6").order("created_at");
    expect((history.data as Any[]).at(-1)).toMatchObject({
      from_stage_id: "prj-leticia:new",
      to_stage_id: "prj-leticia:contacted",
      changed_by: DEMO_USER_ID,
    });
  });

  it("applies the same stage rules as the database", async () => {
    const { next } = memoryStore();
    const move = (stage: string, reason: string | null = null) =>
      next().rpc("move_lead_stage", { p_lead_id: "lead-6", p_to_stage_id: stage, p_lost_reason: reason, p_sale_value: null });

    expect((await move("prj-leticia:lost")).error?.code).toBe("22023");
    expect((await move("prj-leticia:new")).error?.message).toMatch(/already in this stage/);
    expect((await move("prj-joao:contacted")).error?.code).toBe("P0002");
    expect((await move("prj-leticia:lost", "Sem orçamento")).error).toBeNull();

    const lead = await next().from("leads").select("lost_reason").eq("id", "lead-6").single();
    expect((lead.data as Any).lost_reason).toBe("Sem orçamento");
  });

  it("stores the sale value on a win", async () => {
    const { next } = memoryStore();
    await next().rpc("move_lead_stage", {
      p_lead_id: "lead-3",
      p_to_stage_id: "prj-leticia:won",
      p_lost_reason: null,
      p_sale_value: 25000,
    });
    const lead = await next().from("leads").select("sale_value").eq("id", "lead-3").single();
    expect((lead.data as Any).sale_value).toBe(25000);
  });

  it("creates projects with the default pipeline and rejects duplicate slugs", async () => {
    const { next } = memoryStore();
    const created = await next()
      .from("projects")
      .insert({ workspace_id: "ws-exen", name: "Dra Ana", slug: "dra-ana" })
      .select("id")
      .single();
    const id = (created.data as Any).id as string;
    const stages = await next().from("pipeline_stages").select("key").eq("project_id", id).order("position");
    expect((stages.data as Any[]).map((s) => s.key)).toEqual(["new", "contacted", "qualified", "scheduled", "won", "lost"]);

    const dup = await next().from("projects").insert({ workspace_id: "ws-exen", name: "x", slug: "dra-ana" });
    expect(dup.error?.code).toBe("23505");
  });

  it("adds a test lead in the first stage", async () => {
    const { next } = memoryStore();
    const res = await next().rpc("ingest_lead_conversion", {
      p: { project_id: "prj-joao", lead: { name: "Lead de teste 0042", phone_norm: "+5511900000042" } },
    });
    const id = (res.data as Any).lead_id;
    const lead = await next().from("leads").select("name, current_stage_id").eq("id", id).single();
    expect(lead.data).toEqual({ name: "Lead de teste 0042", current_stage_id: "prj-joao:new" });
  });

  it("keeps the cookie small by dropping the oldest changes", async () => {
    const ops: DemoOp[] = Array.from({ length: 200 }, (_, i) => ({
      k: "move",
      l: "lead-6",
      s: i % 2 ? "prj-leticia:new" : "prj-leticia:contacted",
      h: `h-${i}`,
      a: NOW.getTime() + i,
    }));
    const encoded = encodeOps(ops);
    expect(encoded.length).toBeLessThanOrEqual(3600);
    const kept = decodeOps(encoded);
    expect(kept.at(-1)).toEqual(ops.at(-1));
    expect(kept.length).toBeLessThan(ops.length);
  });

  it("ignores a corrupted cookie", () => {
    expect(decodeOps("not-base64-json")).toEqual([]);
  });
});
