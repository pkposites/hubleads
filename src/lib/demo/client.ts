import { randomUUID } from "node:crypto";
import { DEMO_USER_EMAIL, DEMO_USER_ID, type DemoDb, type Row } from "./seed";
import { applyOp, buildState, DemoError, validateMove, type DemoOp } from "./state";

// In-memory stand-in for the subset of the Supabase client the app uses
// (`from(...)` queries, three RPCs and auth claims), so every page runs
// unchanged in demo mode without a database or a login.

export interface OpStore {
  load(): Promise<DemoOp[]>;
  save(ops: DemoOp[]): Promise<void>;
}

interface PgError {
  code: string;
  message: string;
}

interface Result {
  data: unknown;
  error: PgError | null;
  count?: number | null;
}

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
const fail = (code: string, message: string): Result => ({ data: null, error: { code, message } });

/** Splits on commas that are not inside quotes or parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (ch === "," && depth === 0 && !quoted) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function likeToRegExp(pattern: string, caseInsensitive: boolean) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

/** PostgREST `or=(a.ilike."*x*",b.eq.y)` filters, as used by the leads search. */
function parseOr(expr: string): ((row: Row) => boolean)[] {
  return splitTopLevel(expr).map((clause) => {
    const [column, op, ...rest] = clause.split(".");
    const value = rest.join(".").replace(/^"|"$/g, "");
    if (op === "ilike" || op === "like") {
      const re = likeToRegExp(value, op === "ilike");
      return (row) => typeof row[column] === "string" && re.test(row[column] as string);
    }
    return (row) => String(row[column] ?? "") === value;
  });
}

const EMBED_RE = /^(\w+)\s*\(([^)]*)\)$/;

function project(db: DemoDb, row: Row, columns: string): Row {
  const out: Row = {};
  for (const col of splitTopLevel(columns)) {
    if (col === "*") {
      Object.assign(out, row);
      continue;
    }
    const embed = EMBED_RE.exec(col);
    if (embed) {
      const [, table, inner] = embed;
      // workspaces -> workspace_id
      const fk = `${table.replace(/s$/, "")}_id`;
      const related = db[table]?.find((r) => r.id === row[fk]);
      out[table] = related ? project(db, related, inner) : null;
      continue;
    }
    out[col] = row[col];
  }
  return structuredClone(out);
}

class DemoQuery implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private from?: number;
  private to?: number;
  private columns = "*";
  private countExact = false;
  private mode: "many" | "single" | "maybe" = "many";
  private mutation?: { kind: "insert"; rows: Row[] } | { kind: "update"; patch: Row };

  constructor(
    private readonly client: DemoClient,
    private readonly table: string,
  ) {}

  select(columns = "*", options?: { count?: string }) {
    this.columns = columns;
    this.countExact = options?.count === "exact";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  or(expr: string) {
    const clauses = parseOr(expr);
    this.filters.push((row) => clauses.some((clause) => clause(row)));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  limit(n: number) {
    this.from = 0;
    this.to = n - 1;
    return this;
  }
  insert(values: Row | Row[]) {
    this.mutation = { kind: "insert", rows: Array.isArray(values) ? values : [values] };
    return this;
  }
  update(patch: Row) {
    this.mutation = { kind: "update", patch };
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.execute().then(onFulfilled, onRejected);
  }

  private shape(db: DemoDb, rows: Row[], count?: number): Result {
    const data = rows.map((row) => project(db, row, this.columns));
    if (this.mode === "single") {
      return data.length === 1 ? { data: data[0], error: null } : fail("PGRST116", "expected a single row");
    }
    if (this.mode === "maybe") {
      return data.length > 1 ? fail("PGRST116", "expected at most one row") : { data: data[0] ?? null, error: null };
    }
    return { data, error: null, count: this.countExact ? (count ?? data.length) : null };
  }

  private async execute(): Promise<Result> {
    const db = await this.client.state();

    if (this.mutation?.kind === "insert") {
      const created: Row[] = [];
      for (const row of this.mutation.rows) {
        const result = await this.client.insert(this.table, row);
        if (result.error) return result;
        created.push(result.data as Row);
      }
      return this.shape(db, created);
    }

    let rows = (db[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)));

    if (this.mutation?.kind === "update") {
      for (const row of rows) await this.client.update(this.table, row, this.mutation.patch);
      return { data: null, error: null };
    }

    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[column] as string | number;
        const y = b[column] as string | number;
        const cmp = x === y ? 0 : x > y ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    const count = rows.length;
    if (this.from !== undefined) rows = rows.slice(this.from, (this.to ?? rows.length) + 1);
    return this.shape(db, rows, count);
  }
}

export class DemoClient {
  private db?: DemoDb;
  private ops?: DemoOp[];

  constructor(
    private readonly store: OpStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly auth = {
    getClaims: async () => ({ data: { claims: { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL } }, error: null }),
    signOut: async () => ({ error: null }),
  };

  async state(): Promise<DemoDb> {
    if (!this.db) {
      this.ops = await this.store.load();
      this.db = buildState(this.ops, this.now());
    }
    return this.db;
  }

  from(table: string) {
    return new DemoQuery(this, table);
  }

  private async commit(op: DemoOp) {
    const db = await this.state();
    applyOp(db, op);
    this.ops = [...(this.ops ?? []), op];
    await this.store.save(this.ops);
  }

  async insert(table: string, row: Row): Promise<Result> {
    const db = await this.state();
    const at = this.now().getTime();
    const str = (key: string) => String(row[key] ?? "");

    switch (table) {
      case "projects": {
        if (db.projects.some((p) => p.workspace_id === row.workspace_id && p.slug === row.slug)) {
          return fail("23505", "duplicate project slug");
        }
        const i = newId("prj");
        await this.commit({ k: "project", i, w: str("workspace_id"), n: str("name"), g: str("slug"), a: at });
        return { data: db.projects.find((p) => p.id === i), error: null };
      }
      case "landing_pages": {
        const i = newId("lp");
        await this.commit({
          k: "lp",
          i,
          w: str("workspace_id"),
          p: str("project_id"),
          n: str("name"),
          d: (row.domains as string[]) ?? [],
          a: at,
        });
        return { data: db.landing_pages.find((r) => r.id === i), error: null };
      }
      case "forms": {
        if (db.forms.some((f) => f.project_id === row.project_id && f.key === row.key)) {
          return fail("23505", "duplicate form key");
        }
        const i = newId("frm");
        await this.commit({ k: "form", i, w: str("workspace_id"), p: str("project_id"), n: str("name"), key: str("key"), a: at });
        return { data: db.forms.find((r) => r.id === i), error: null };
      }
      case "project_api_keys": {
        const i = newId("key");
        await this.commit({
          k: "key",
          i,
          w: str("workspace_id"),
          p: str("project_id"),
          n: str("name"),
          pre: str("key_prefix"),
          a: at,
        });
        return { data: db.project_api_keys.find((r) => r.id === i), error: null };
      }
      default:
        return fail("42501", `demo mode cannot write to ${table}`);
    }
  }

  async update(table: string, row: Row, patch: Row) {
    if (table === "project_api_keys" && patch.revoked_at) {
      await this.commit({ k: "revoke", i: String(row.id), a: this.now().getTime() });
    }
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<Result> {
    const db = await this.state();
    const at = this.now().getTime();

    try {
      switch (name) {
        case "move_lead_stage": {
          const leadId = String(args.p_lead_id);
          const stageId = String(args.p_to_stage_id);
          const reason = (args.p_lost_reason as string | null) ?? undefined;
          const value = args.p_sale_value as number | null;
          validateMove(db, leadId, stageId, reason);
          if (value !== null && value !== undefined && value < 0) {
            throw new DemoError("22023", "sale_value must not be negative");
          }
          const h = newId("h");
          await this.commit({
            k: "move",
            l: leadId,
            s: stageId,
            h,
            a: at,
            ...(reason?.trim() ? { r: reason.trim() } : {}),
            ...(value !== null && value !== undefined ? { v: value } : {}),
          });
          return { data: db.lead_stage_history.find((r) => r.id === h), error: null };
        }
        case "create_workspace": {
          const slug = String(args.p_slug);
          if (db.workspaces.some((w) => w.slug === slug)) throw new DemoError("23505", "duplicate workspace slug");
          const i = newId("ws");
          await this.commit({ k: "workspace", i, n: String(args.p_name), g: slug, a: at });
          return { data: db.workspaces.find((w) => w.id === i), error: null };
        }
        case "ingest_lead_conversion": {
          const p = args.p as { project_id: string; lead: { name?: string; phone_norm?: string } };
          if (!db.projects.some((r) => r.id === p.project_id)) throw new DemoError("LH404", "project not found");
          const i = newId("lead");
          await this.commit({ k: "lead", i, p: p.project_id, n: p.lead.name ?? "Lead", ph: p.lead.phone_norm ?? "", a: at });
          return {
            data: { lead_id: i, conversion_id: `${i}:cnv`, created: true, duplicate: false, replayed: false },
            error: null,
          };
        }
        default:
          return fail("42883", `demo mode does not implement ${name}`);
      }
    } catch (error) {
      if (error instanceof DemoError) return fail(error.code, error.message);
      throw error;
    }
  }
}

export function createDemoClient(store: OpStore, now?: () => Date) {
  return new DemoClient(store, now);
}
