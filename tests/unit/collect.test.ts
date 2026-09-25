import { describe, expect, it, vi } from "vitest";
import { cleanAnswers, clientIp, deviceFrom, handleCollect, handleConfig, type CollectDeps } from "@/lib/collect";

function deps(overrides: Partial<CollectDeps> = {}) {
  const logs: Record<string, unknown>[] = [];
  const d: CollectDeps & { logs: typeof logs } = {
    logs,
    collect: vi.fn(async () => ({ ok: true, code: "7F3K" })),
    pageConfig: vi.fn(async (key: string) => (key === "pk_ok" ? { whatsapp_code: true } : null)),
    log: (e) => logs.push(e),
    ...overrides,
  };
  return d;
}

const event = {
  key: "pk_ok",
  type: "whatsapp_click",
  visitor_id: "abc123def456",
  url: "https://clinica.com.br/lp",
  name: " Maria ",
  code: "7f3k",
  attribution: {
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "sp",
    fbclid: "IwAR",
    fbp: "fb.1.1.2",
    landing_url: "https://clinica.com.br/lp?utm_source=facebook",
    unknown_field: "dropped",
  },
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://leadhub.test/api/collect", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      Origin: "https://clinica.com.br",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/collect", () => {
  it("keeps only the typed contact when the visitor refused tracking", async () => {
    const d = deps();
    await handleCollect(
      post({ ...event, consent: false, phone: "11 91234-5678", url_params: { utm_source: "facebook" } }, { "X-Real-IP": "200.1.2.3" }),
      d,
    );
    const forwarded = (d.collect as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(forwarded).toMatchObject({ consent: false, channel: "sem_consentimento", name: "Maria", phone: "+5511912345678", attribution: {}, url_params: {} });
    expect(forwarded.ip_address).toBeUndefined();
    expect(forwarded.user_agent).toBeUndefined();
  });

  it("drops page events with no commercial meaning", async () => {
    const d = deps();
    const res = await handleCollect(post({ ...event, type: "lp_event", data: { event: "PageView" } }), d);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(d.collect).not.toHaveBeenCalled();
    await handleCollect(post({ ...event, type: "lp_event", data: { event: "Lead", source: "pixel" } }), d);
    expect(d.collect).toHaveBeenCalledTimes(1);
  });

  it("announces only clicks that created a new row", async () => {
    const onNewLead = vi.fn();
    const created = deps({ onNewLead, collect: vi.fn(async () => ({ ok: true, lead_id: "L1", new_lead: true })) });
    await handleCollect(post(event), created);
    expect(onNewLead).toHaveBeenCalledWith("L1");

    const repeat = deps({ onNewLead, collect: vi.fn(async () => ({ ok: true, lead_id: "L1", new_lead: false })) });
    await handleCollect(post(event), repeat);
    expect(onNewLead).toHaveBeenCalledTimes(1);
  });

  it("classifies the visit and forwards a clean event", async () => {
    const d = deps();
    const res = await handleCollect(post(event), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ ok: true, code: "7F3K" });

    const [key, host, payload] = vi.mocked(d.collect).mock.calls[0];
    expect(key).toBe("pk_ok");
    expect(host).toBe("clinica.com.br");
    expect(payload).toMatchObject({ type: "whatsapp_click", channel: "meta_ads", device: "mobile", name: "Maria", code: "7F3K" });
    expect((payload.attribution as Record<string, string>).unknown_field).toBeUndefined();
  });

  it("falls back to the Referer when there is no Origin", async () => {
    const d = deps();
    await handleCollect(post(event, { Origin: "", Referer: "https://www.clinica.com.br/lp" }), d);
    expect(vi.mocked(d.collect).mock.calls[0][1]).toBe("www.clinica.com.br");
  });

  it("logs without names or codes", async () => {
    const d = deps();
    await handleCollect(post(event), d);
    expect(JSON.stringify(d.logs)).not.toMatch(/Maria|7F3K|clinica/);
  });

  it.each([
    ["invalid JSON", "{nope", 400],
    ["missing visitor", { ...event, visitor_id: undefined }, 400],
    ["bad code", { ...event, code: "0O1I" }, 400],
    ["too large", { ...event, data: { blob: "x".repeat(20_000) } }, 413],
  ])("rejects %s", async (_label, body, status) => {
    const d = deps();
    expect((await handleCollect(post(body), d)).status).toBe(status);
    expect(d.collect).not.toHaveBeenCalled();
  });

  it.each([
    ["LH401", 401],
    ["LH403", 403],
    ["XX000", 500],
  ])("maps database error %s to %i", async (code, status) => {
    const d = deps({ collect: vi.fn(async () => Promise.reject({ code })) });
    expect((await handleCollect(post(event), d)).status).toBe(status);
  });
});

describe("phone from the landing page", () => {
  it.each([
    ["(11) 91234-5678", "+5511912345678"],
    ["+55 11 91234-5678", "+5511912345678"],
    ["123", "123"],
    ["  ", undefined],
  ])("%j is stored as %j", async (phone, expected) => {
    const d = deps();
    await handleCollect(post({ ...event, phone }), d);
    expect(vi.mocked(d.collect).mock.calls[0][2].phone).toBe(expected);
  });

  it("never logs the phone", async () => {
    const d = deps();
    await handleCollect(post({ ...event, phone: "(11) 91234-5678" }), d);
    expect(JSON.stringify(d.logs)).not.toMatch(/1234|5678/);
  });
});

describe("GET /api/collect", () => {
  it("returns the page settings for a known key", async () => {
    const res = await handleConfig(new Request("https://leadhub.test/api/collect?key=pk_ok"), deps());
    expect(await res.json()).toEqual({ whatsapp_code: true });
    expect((await handleConfig(new Request("https://leadhub.test/api/collect?key=pk_x"), deps())).status).toBe(404);
  });
});

describe("deviceFrom", () => {
  it.each([
    ["Mozilla/5.0 (Linux; Android 14) Mobile Safari", "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0)", "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "desktop"],
    [null, "desconhecido"],
  ])("%s -> %s", (ua, expected) => {
    expect(deviceFrom(ua)).toBe(expected);
  });
});

describe("cleanAnswers", () => {
  it("keeps flat, short answers and drops the rest", () => {
    expect(
      cleanAnswers({
        " tempo ": " 5 anos ",
        nota: 9,
        ok: true,
        areas: ["Coroa", 2, { x: 1 }],
        nested: { a: 1 },
        vazio: "",
        longo: "x".repeat(600),
        nan: Number.NaN,
      }),
    ).toEqual({ tempo: "5 anos", nota: 9, ok: true, areas: "Coroa, 2", longo: "x".repeat(500) });
  });

  it("caps the number of answers", () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`q${i}`, "a"]));
    expect(Object.keys(cleanAnswers(many))).toHaveLength(40);
  });
});

describe("data for Meta's Conversions API", () => {
  it("records the visitor IP and user agent", async () => {
    const d = deps();
    await handleCollect(post(event, { "x-nf-client-connection-ip": "200.100.50.25" }), d);
    const payload = vi.mocked(d.collect).mock.calls[0][2];
    expect(payload).toMatchObject({ ip_address: "200.100.50.25", user_agent: expect.stringContaining("iPhone") });
  });

  it.each([
    [{ "x-forwarded-for": "187.1.2.3, 10.0.0.1" }, "187.1.2.3"],
    [{ "x-real-ip": "2804:14c::1" }, "2804:14c::1"],
    [{ "x-forwarded-for": "<script>" }, undefined],
    [{}, undefined],
  ])("reads the IP from %j", (headers, expected) => {
    expect(clientIp(new Request("https://x.test", { headers }))).toBe(expected);
  });
});
