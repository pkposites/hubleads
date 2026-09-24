import { describe, expect, it, vi } from "vitest";
import { handleLeadIngest, type IngestDeps } from "@/lib/ingest/handler";
import { hashSecretKey } from "@/lib/ingest/keys";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const SECRET = "sk_live_test-secret-key-value-0000000000000000";

function deps(overrides: Partial<IngestDeps> = {}) {
  const logs: Record<string, unknown>[] = [];
  const d: IngestDeps & { logs: typeof logs } = {
    logs,
    findSecretKey: vi.fn(async (hash: string) =>
      hash === hashSecretKey(SECRET) ? { id: "key-1", project_id: PROJECT, workspace_id: "ws-1" } : null,
    ),
    findLandingPage: vi.fn(async (key: string) =>
      key === "pk_live_ok"
        ? { id: "lp-1", project_id: PROJECT, workspace_id: "ws-1", domains: ["cliente.com.br"] }
        : null,
    ),
    findForm: vi.fn(async (_p: string, ref: string) => (ref === "frm_transplante" ? { id: "form-1" } : null)),
    ingest: vi.fn(async () => ({
      lead_id: "lead-1",
      conversion_id: "conv-1",
      created: true,
      duplicate: false,
      replayed: false,
      received_at: "2026-09-22T18:00:01Z",
    })),
    log: (entry) => logs.push(entry),
    now: () => new Date("2026-09-22T18:00:00Z"),
    ...overrides,
  };
  return d;
}

const body = {
  form_id: "frm_transplante",
  lead: { name: "Joao da Silva", phone: "(11) 99999-9999", email: "Joao@Example.com" },
  answers: { budget_range: "10k_20k", city: "Sao Paulo" },
  tracking: {
    session_id: "ses_1",
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "transplante_sp",
    ad_id: "456789",
    fbclid: "fb.1",
    fbc: "fb.1.123.abc",
    fbp: "fb.1.123.456",
    landing_page_url: "https://cliente.com.br/transplante?utm_source=facebook#x",
  },
  consent: { privacy_policy: true },
};

const publicRequest = (payload: unknown = body, headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/v1/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://cliente.com.br",
      "X-Project-Key": "pk_live_ok",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

const secretRequest = (headers: Record<string, string> = {}) =>
  new Request("https://app.test/api/v1/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}`, ...headers },
    body: JSON.stringify(body),
  });

describe("POST /v1/leads", () => {
  it("creates a conversion from an authorised landing page", async () => {
    const d = deps();
    const res = await handleLeadIngest(publicRequest(), d);

    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://cliente.com.br");
    expect(await res.json()).toEqual({
      lead_id: "lead-1",
      conversion_id: "conv-1",
      created: true,
      duplicate: false,
      received_at: "2026-09-22T18:00:01Z",
    });

    const payload = vi.mocked(d.ingest).mock.calls[0][0];
    expect(payload).toMatchObject({
      project_id: PROJECT,
      form_id: "form-1",
      landing_page_id: "lp-1",
      session_id: "ses_1",
      lead: { phone_norm: "+5511999999999", email_norm: "joao@example.com", name: "Joao da Silva" },
      answers: { budget_range: "10k_20k", city: "Sao Paulo" },
      touch: {
        channel: "meta_ads",
        ad_id: "456789",
        fbc: "fb.1.123.abc",
        landing_page_url: "https://cliente.com.br/transplante?utm_source=facebook",
      },
      consent: { privacy_policy: true, captured_at: "2026-09-22T18:00:00.000Z" },
    });
    expect(payload.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("logs without personal data", async () => {
    const d = deps();
    await handleLeadIngest(publicRequest(), d);
    const line = JSON.stringify(d.logs);
    expect(line).not.toMatch(/9999|joao|Joao|fb\.1/);
    expect(d.logs[0]).toMatchObject({ result: "created", status: 201, workspace_id: "ws-1", project_id: PROJECT });
  });

  it("rejects an unknown public key", async () => {
    const res = await handleLeadIngest(publicRequest(body, { "X-Project-Key": "pk_live_nope" }), deps());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_PROJECT_KEY");
  });

  it("rejects a request without any key", async () => {
    const req = new Request("https://app.test/api/v1/leads", { method: "POST", body: JSON.stringify(body) });
    expect((await handleLeadIngest(req, deps())).status).toBe(401);
  });

  it("rejects an origin that is not authorised for the key", async () => {
    const d = deps();
    const res = await handleLeadIngest(publicRequest(body, { Origin: "https://evil.com" }), d);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it("accepts a secret key server to server", async () => {
    const d = deps();
    const res = await handleLeadIngest(secretRequest({ "Idempotency-Key": "abc" }), d);
    expect(res.status).toBe(201);
    expect(vi.mocked(d.ingest).mock.calls[0][0]).toMatchObject({ idempotency_key: "abc", landing_page_id: null });
  });

  it("requires an Idempotency-Key server to server", async () => {
    const res = await handleLeadIngest(secretRequest(), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error.details[0].field).toBe("Idempotency-Key");
  });

  it("rejects a revoked or unknown secret key", async () => {
    const res = await handleLeadIngest(
      secretRequest({ Authorization: "Bearer sk_live_wrong", "Idempotency-Key": "abc" }),
      deps(),
    );
    expect(res.status).toBe(401);
  });

  it("returns field errors for invalid input", async () => {
    const res = await handleLeadIngest(publicRequest({ ...body, lead: { phone: "123", email: "x" } }), deps());
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.details.map((d: { field: string }) => d.field)).toEqual(["lead.phone", "lead.email"]);
  });

  it("requires a phone or e-mail", async () => {
    const res = await handleLeadIngest(publicRequest({ lead: { name: "Só nome" } }), deps());
    expect((await res.json()).error.details).toEqual([{ field: "lead", message: "Informe telefone ou e-mail." }]);
  });

  it("rejects malformed JSON", async () => {
    const res = await handleLeadIngest(publicRequest("{nope"), deps());
    expect(res.status).toBe(400);
  });

  it("rejects an unknown form", async () => {
    const res = await handleLeadIngest(publicRequest({ ...body, form_id: "frm_outro" }), deps());
    expect((await res.json()).error.details).toEqual([{ field: "form_id", message: "Formulário não encontrado." }]);
  });

  it("maps an idempotency conflict to 409", async () => {
    const d = deps({ ingest: vi.fn(async () => Promise.reject({ code: "LH409" })) });
    const res = await handleLeadIngest(publicRequest(), d);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DUPLICATE_REQUEST");
  });

  it("maps an archived project to 404", async () => {
    const d = deps({ ingest: vi.fn(async () => Promise.reject({ code: "LH404" })) });
    expect((await handleLeadIngest(publicRequest(), d)).status).toBe(404);
  });

  it("hides internal errors behind a request id", async () => {
    const d = deps({ ingest: vi.fn(async () => Promise.reject(new Error("connection refused to db.internal"))) });
    const res = await handleLeadIngest(publicRequest(), d);
    const { error } = await res.json();
    expect(res.status).toBe(500);
    expect(error.message).not.toMatch(/db\.internal/);
    expect(error.request_id).toBe(res.headers.get("x-request-id"));
  });

  it("answers 200 with the original ids on a replay", async () => {
    const d = deps({
      ingest: vi.fn(async () => ({
        lead_id: "lead-1",
        conversion_id: "conv-1",
        created: false,
        duplicate: true,
        replayed: true,
        received_at: "2026-09-22T18:00:01Z",
      })),
    });
    const res = await handleLeadIngest(publicRequest(body, { "Idempotency-Key": "k" }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lead_id: "lead-1", conversion_id: "conv-1" });
  });

  it("silently drops honeypot submissions", async () => {
    const d = deps();
    const res = await handleLeadIngest(publicRequest({ ...body, website: "http://spam" }), d);
    expect(res.status).toBe(201);
    expect(d.ingest).not.toHaveBeenCalled();
  });

  it("hashes the same payload the same way regardless of key order", async () => {
    const d = deps();
    await handleLeadIngest(publicRequest(body), d);
    const reordered = { consent: body.consent, tracking: body.tracking, answers: body.answers, lead: body.lead, form_id: body.form_id };
    await handleLeadIngest(publicRequest(reordered), d);
    const [a, b] = vi.mocked(d.ingest).mock.calls.map((c) => c[0].request_hash);
    expect(a).toBe(b);
  });

  it("keeps the SDK's first touch separate from the current touch", async () => {
    const d = deps();
    await handleLeadIngest(
      publicRequest({
        ...body,
        tracking: { ...body.tracking, first_touch: { gclid: "g-1", occurred_at: "2026-09-01T10:00:00Z" } },
      }),
      d,
    );
    const payload = vi.mocked(d.ingest).mock.calls[0][0];
    expect(payload.first_touch).toEqual({ gclid: "g-1", occurred_at: "2026-09-01T10:00:00Z", channel: "google_ads" });
    expect((payload.touch as { channel: string }).channel).toBe("meta_ads");
  });
});
