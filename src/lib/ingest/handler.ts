import { randomUUID } from "node:crypto";
import { ApiError } from "./errors";
import { hashSecretKey, originAllowed, SECRET_KEY_PREFIX } from "./keys";
import { hashRequest, prepareLead } from "./prepare";
import { leadRequestSchema } from "./schema";

// POST /v1/leads (blueprint §8). Kept free of Next.js and Supabase so it can
// be tested with plain Request objects and fake dependencies.

const MAX_BODY_BYTES = 64 * 1024;

export interface IngestResult {
  lead_id: string;
  conversion_id: string;
  created: boolean;
  duplicate: boolean;
  replayed: boolean;
  received_at: string;
}

export interface IngestDeps {
  findSecretKey(hash: string): Promise<{ id: string; project_id: string; workspace_id: string } | null>;
  findLandingPage(
    publicKey: string,
  ): Promise<{ id: string; project_id: string; workspace_id: string; domains: string[] } | null>;
  findForm(projectId: string, ref: string): Promise<{ id: string } | null>;
  /** Calls public.ingest_lead_conversion; rejects with `{ code }` on SQL errors. */
  ingest(payload: Record<string, unknown>): Promise<IngestResult>;
  markKeyUsed?(keyId: string): Promise<void>;
  log(entry: Record<string, unknown>): void;
  now?(): Date;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Project-Key, Idempotency-Key",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function sqlErrorToApi(error: unknown): ApiError {
  const code = (error as { code?: string } | null)?.code;
  if (code === "LH409") return new ApiError("DUPLICATE_REQUEST");
  if (code === "LH404") return new ApiError("PROJECT_NOT_FOUND");
  if (code === "22023") return new ApiError("INVALID_REQUEST");
  return new ApiError("INTERNAL_ERROR");
}

export async function handleLeadIngest(request: Request, deps: IngestDeps): Promise<Response> {
  const started = Date.now();
  const requestId = randomUUID();
  const origin = request.headers.get("origin");
  const baseHeaders: Record<string, string> = { "X-Request-Id": requestId };
  if (origin) {
    baseHeaders["Access-Control-Allow-Origin"] = origin;
    baseHeaders["Access-Control-Expose-Headers"] = "X-Request-Id";
    baseHeaders.Vary = "Origin";
  }

  const logContext: Record<string, unknown> = { route: "POST /v1/leads", request_id: requestId };

  try {
    // --- Authentication (§8.1) -------------------------------------------
    const authorization = request.headers.get("authorization");
    const publicKey = request.headers.get("x-project-key")?.trim();
    let projectId: string;
    let landingPageId: string | null = null;
    let secretKeyId: string | null = null;

    if (authorization) {
      const [scheme, token] = authorization.split(" ");
      if (scheme?.toLowerCase() !== "bearer" || !token?.startsWith(SECRET_KEY_PREFIX)) {
        throw new ApiError("INVALID_PROJECT_KEY");
      }
      const key = await deps.findSecretKey(hashSecretKey(token));
      if (!key) throw new ApiError("INVALID_PROJECT_KEY");
      projectId = key.project_id;
      secretKeyId = key.id;
      Object.assign(logContext, { mode: "secret", workspace_id: key.workspace_id, project_id: key.project_id });
    } else if (publicKey) {
      const page = await deps.findLandingPage(publicKey);
      if (!page) throw new ApiError("INVALID_PROJECT_KEY");
      Object.assign(logContext, { mode: "public", workspace_id: page.workspace_id, project_id: page.project_id });
      if (!originAllowed(origin, page.domains)) throw new ApiError("ORIGIN_NOT_ALLOWED");
      projectId = page.project_id;
      landingPageId = page.id;
    } else {
      throw new ApiError("INVALID_PROJECT_KEY");
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 200) {
      throw new ApiError("INVALID_REQUEST", [{ field: "Idempotency-Key", message: "Máximo de 200 caracteres." }]);
    }
    if (secretKeyId && !idempotencyKey) {
      throw new ApiError("INVALID_REQUEST", [
        { field: "Idempotency-Key", message: "Obrigatório em integrações server to server." },
      ]);
    }

    // --- Body ---------------------------------------------------------------
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      throw new ApiError("INVALID_REQUEST", [{ field: "body", message: "Corpo acima de 64 KB." }]);
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new ApiError("INVALID_REQUEST", [{ field: "body", message: "JSON inválido." }]);
    }
    const parsed = leadRequestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST",
        parsed.error.issues.slice(0, 20).map((i) => ({ field: i.path.join(".") || "body", message: i.message })),
      );
    }
    const body = parsed.data;
    const now = deps.now?.() ?? new Date();

    // Honeypot hit: pretend success, store nothing.
    if (body.website) {
      deps.log({ ...logContext, level: "warn", result: "honeypot", status: 201, latency_ms: Date.now() - started });
      return json(
        201,
        {
          lead_id: randomUUID(),
          conversion_id: randomUUID(),
          created: true,
          duplicate: false,
          received_at: now.toISOString(),
        },
        baseHeaders,
      );
    }

    const prepared = prepareLead(body, now);
    if (!prepared.ok) throw new ApiError("INVALID_REQUEST", prepared.errors);

    let formId: string | null = null;
    if (body.form_id) {
      const form = await deps.findForm(projectId, body.form_id);
      if (!form) throw new ApiError("INVALID_REQUEST", [{ field: "form_id", message: "Formulário não encontrado." }]);
      formId = form.id;
    }

    // --- Persist (§3.2 step 5) ---------------------------------------------
    let result: IngestResult;
    try {
      result = await deps.ingest({
        project_id: projectId,
        form_id: formId,
        landing_page_id: landingPageId,
        session_id: prepared.value.session_id,
        idempotency_key: idempotencyKey,
        request_hash: hashRequest(body),
        lead: prepared.value.lead,
        answers: prepared.value.answers,
        touch: prepared.value.touch,
        first_touch: prepared.value.first_touch,
        tracking: prepared.value.tracking,
        consent: prepared.value.consent,
      });
    } catch (error) {
      const apiError = sqlErrorToApi(error);
      if (apiError.code === "INTERNAL_ERROR") {
        logContext.cause = (error as { code?: string } | null)?.code ?? "unknown";
      }
      throw apiError;
    }

    if (secretKeyId && deps.markKeyUsed) {
      // Best effort; never fail the submission because of it.
      await deps.markKeyUsed(secretKeyId).catch(() => undefined);
    }

    const status = result.replayed ? 200 : 201;
    deps.log({
      ...logContext,
      level: "info",
      result: result.replayed ? "replayed" : result.created ? "created" : "duplicate",
      status,
      channel: prepared.value.touch.channel,
      latency_ms: Date.now() - started,
    });
    return json(
      status,
      {
        lead_id: result.lead_id,
        conversion_id: result.conversion_id,
        created: result.created,
        duplicate: result.duplicate,
        received_at: result.received_at,
      },
      baseHeaders,
    );
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
    deps.log({
      ...logContext,
      level: apiError.status >= 500 ? "error" : "warn",
      result: "rejected",
      status: apiError.status,
      error_code: apiError.code,
      latency_ms: Date.now() - started,
    });
    return json(
      apiError.status,
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.details ? { details: apiError.details } : {}),
          request_id: requestId,
        },
      },
      baseHeaders,
    );
  }
}
