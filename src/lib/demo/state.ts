import { buildSeed, DEMO_USER_ID, stageRows, type DemoDb, type Row } from "./seed";

// Demo mode keeps each visitor's changes as a short log of operations (stored
// in a cookie) and replays it over the seed on every request. Keys are kept
// short because the whole log has to fit in one cookie.

export type DemoOp =
  | { k: "move"; l: string; s: string; h: string; a: number; r?: string; v?: number }
  | { k: "workspace"; i: string; n: string; g: string; a: number }
  | { k: "project"; i: string; w: string; n: string; g: string; a: number }
  | { k: "lp"; i: string; w: string; p: string; n: string; d: string[]; a: number }
  | { k: "form"; i: string; w: string; p: string; n: string; key: string; a: number }
  | { k: "key"; i: string; w: string; p: string; n: string; pre: string; a: number }
  | { k: "revoke"; i: string; a: number }
  | { k: "lead"; i: string; p: string; n: string; ph: string; a: number };

const iso = (ms: number) => new Date(ms).toISOString();
const find = (db: DemoDb, table: string, id: unknown) => db[table].find((r) => r.id === id);

export class DemoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Same rules as leadhub.move_lead_stage (§9, §13.3). */
export function validateMove(db: DemoDb, leadId: string, stageId: string, lostReason?: string | null) {
  const lead = find(db, "leads", leadId);
  if (!lead) throw new DemoError("P0002", "lead not found");
  const stage = find(db, "pipeline_stages", stageId);
  if (!stage || stage.project_id !== lead.project_id) throw new DemoError("P0002", "stage not found in this project");
  if (stage.kind === "lost" && !lostReason?.trim()) {
    throw new DemoError("22023", "lost_reason is required when moving to a lost stage");
  }
  if (lead.current_stage_id === stage.id) throw new DemoError("22023", "lead is already in this stage");
  return { lead, stage };
}

export function applyOp(db: DemoDb, op: DemoOp): void {
  switch (op.k) {
    case "move": {
      let lead: Row;
      let stage: Row;
      try {
        ({ lead, stage } = validateMove(db, op.l, op.s, op.r));
      } catch {
        return; // Stale op (e.g. its target was trimmed from the log).
      }
      const from = lead.current_stage_id;
      lead.current_stage_id = stage.id;
      lead.lost_reason = stage.kind === "lost" ? op.r : null;
      if (stage.kind === "won" && op.v !== undefined) lead.sale_value = op.v;
      lead.updated_at = iso(op.a);
      db.lead_stage_history.push({
        id: op.h,
        workspace_id: lead.workspace_id,
        lead_id: lead.id,
        from_stage_id: from,
        to_stage_id: stage.id,
        changed_by: DEMO_USER_ID,
        metadata: {
          ...(stage.kind === "lost" ? { lost_reason: op.r } : {}),
          ...(stage.kind === "won" && op.v !== undefined ? { sale_value: op.v } : {}),
        },
        created_at: iso(op.a),
      });
      return;
    }
    case "workspace":
      db.workspaces.push({ id: op.i, name: op.n, slug: op.g, created_at: iso(op.a) });
      db.workspace_members.push({ workspace_id: op.i, user_id: DEMO_USER_ID, role: "admin", created_at: iso(op.a) });
      return;
    case "project":
      if (!find(db, "workspaces", op.w)) return;
      db.projects.push({ id: op.i, workspace_id: op.w, name: op.n, slug: op.g, status: "active", created_at: iso(op.a) });
      db.pipeline_stages.push(...stageRows(op.w, op.i, iso(op.a)));
      return;
    case "lp":
      if (!find(db, "projects", op.p)) return;
      db.landing_pages.push({
        id: op.i,
        workspace_id: op.w,
        project_id: op.p,
        name: op.n,
        domains: op.d,
        public_key: `pk_live_demo${op.i.replace(/-/g, "")}`,
        status: "active",
        created_at: iso(op.a),
      });
      return;
    case "form":
      if (!find(db, "projects", op.p)) return;
      db.forms.push({ id: op.i, workspace_id: op.w, project_id: op.p, name: op.n, key: op.key, created_at: iso(op.a) });
      return;
    case "key":
      if (!find(db, "projects", op.p)) return;
      db.project_api_keys.push({
        id: op.i,
        workspace_id: op.w,
        project_id: op.p,
        name: op.n,
        key_prefix: op.pre,
        created_at: iso(op.a),
        last_used_at: null,
        revoked_at: null,
      });
      return;
    case "revoke": {
      const key = find(db, "project_api_keys", op.i);
      if (key) key.revoked_at = iso(op.a);
      return;
    }
    case "lead": {
      const project = find(db, "projects", op.p);
      if (!project) return;
      const at = iso(op.a);
      const firstStage = db.pipeline_stages
        .filter((s) => s.project_id === op.p)
        .sort((a, b) => Number(a.position) - Number(b.position))[0];
      const touch = { channel: "referral", utm_source: "leadhub", utm_medium: "test", utm_campaign: "lead_de_teste", occurred_at: at };
      db.leads.push({
        id: op.i,
        workspace_id: project.workspace_id,
        project_id: op.p,
        name: op.n,
        phone: op.ph,
        phone_norm: op.ph,
        email: null,
        email_norm: null,
        current_stage_id: firstStage?.id ?? null,
        owner_id: null,
        estimated_value: null,
        sale_value: null,
        currency: "BRL",
        lost_reason: null,
        needs_review: false,
        first_touch: touch,
        last_touch: touch,
        source_channel: "referral",
        created_at: at,
        updated_at: at,
      });
      db.lead_conversions.push({
        id: `${op.i}:cnv`,
        lead_id: op.i,
        workspace_id: project.workspace_id,
        project_id: op.p,
        form_id: null,
        source_channel: "referral",
        answers: { origem: "Botão de lead de teste" },
        tracking: { test: true },
        consent: { privacy_policy: true, captured_at: at },
        created_at: at,
      });
      db.lead_stage_history.push({
        id: `${op.i}:h0`,
        workspace_id: project.workspace_id,
        lead_id: op.i,
        from_stage_id: null,
        to_stage_id: firstStage?.id ?? null,
        changed_by: null,
        metadata: { reason: "created" },
        created_at: at,
      });
      return;
    }
  }
}

export function buildState(ops: readonly DemoOp[], now = new Date()): DemoDb {
  const db = buildSeed(now);
  for (const op of ops) applyOp(db, op);
  return db;
}

// --- Cookie encoding --------------------------------------------------------

export const DEMO_COOKIE = "lh_demo";
/** Browsers cap a cookie at ~4 KB; stay well under it. */
const MAX_COOKIE_BYTES = 3600;

export function encodeOps(ops: readonly DemoOp[]): string {
  let kept = [...ops];
  let value = Buffer.from(JSON.stringify(kept)).toString("base64url");
  // Drop the oldest changes first when the log grows too long.
  while (value.length > MAX_COOKIE_BYTES && kept.length > 0) {
    kept = kept.slice(1);
    value = Buffer.from(JSON.stringify(kept)).toString("base64url");
  }
  return value;
}

export function decodeOps(value: string | undefined): DemoOp[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return Array.isArray(parsed) ? (parsed as DemoOp[]) : [];
  } catch {
    return [];
  }
}
