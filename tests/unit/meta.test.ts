import { describe, expect, it, vi } from "vitest";
import { dueEvents, normalizeMetaPhone, normalizeName, sendMetaEvent, sha256, type MetaConfig, type MetaLead } from "@/lib/meta";

const config: MetaConfig = {
  pixel_id: "123456789",
  access_token: "EAAsecret",
  test_event_code: null,
  send_schedule: true,
  send_purchase: true,
};

const lead = (patch: Partial<MetaLead> = {}): MetaLead => ({
  id: "lead-1",
  workspace_id: "ws-1",
  visitor_id: "vid123",
  status: "agendado",
  name: "  Letícia  Souza ",
  phone: "+5511912345678",
  sale_value: null,
  fbc: "fb.1.1.IwAR",
  fbp: "fb.1.1.99",
  ip_address: "200.100.50.25",
  user_agent: "Mozilla/5.0 (iPhone)",
  landing_url: "https://clinica.com.br/lp",
  ...patch,
});

describe("Meta conversions", () => {
  it("normalizes names and phones the way Meta hashes them", () => {
    expect(normalizeName("Letícia")).toBe("leticia");
    expect(normalizeMetaPhone("+55 (11) 91234-5678")).toBe("5511912345678");
    expect(normalizeMetaPhone("11912345678")).toBe("5511912345678");
    expect(normalizeMetaPhone("123")).toBeNull();
  });

  it("sends Schedule once for a booked lead, with hashed contact and click ids", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const [event] = dueEvents(lead(), config, [], now);
    expect(event).toMatchObject({
      event_name: "Schedule",
      event_id: "lead-1.Schedule",
      event_time: now.getTime() / 1000,
      action_source: "website",
      event_source_url: "https://clinica.com.br/lp",
    });
    expect(event.user_data).toEqual({
      country: [sha256("br")],
      ph: [sha256("5511912345678")],
      fn: [sha256("leticia")],
      ln: [sha256("souza")],
      external_id: [sha256("vid123")],
      client_ip_address: "200.100.50.25",
      client_user_agent: "Mozilla/5.0 (iPhone)",
      fbc: "fb.1.1.IwAR",
      fbp: "fb.1.1.99",
    });
    expect(dueEvents(lead(), config, ["Schedule"])).toEqual([]);
    expect(dueEvents(lead(), { ...config, send_schedule: false }, [])).toEqual([]);
  });

  it("sends Purchase only when the sale has a value", () => {
    expect(dueEvents(lead({ status: "venda" }), config, [])).toEqual([]);
    const [event] = dueEvents(lead({ status: "venda", sale_value: "18000.50" }), config, []);
    expect(event).toMatchObject({ event_name: "Purchase", custom_data: { currency: "BRL", value: 18000.5 } });
    expect(dueEvents(lead({ status: "perdido", sale_value: 10 }), config, [])).toEqual([]);
  });

  it("sends nothing for visitors who refused tracking", () => {
    expect(dueEvents(lead({ tracking_consent: false }), config, [])).toEqual([]);
    expect(dueEvents(lead({ tracking_consent: true }), config, [])).toHaveLength(1);
  });

  it("reports hand-typed leads as chat conversions", () => {
    const [event] = dueEvents(lead({ user_agent: null, landing_url: null, fbc: null, fbp: null }), config, []);
    expect(event.action_source).toBe("chat");
    expect(event).not.toHaveProperty("event_source_url");
  });

  it("posts to the Graph API with the test code and hides the token in the response", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"events_received":1,"echo":"EAAsecret"}', { status: 200 }));
    const [event] = dueEvents(lead(), config, []);
    const result = await sendMetaEvent({ ...config, test_event_code: "TEST1" }, event, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, response: '{"events_received":1,"echo":"***"}' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123456789\/events$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ test_event_code: "TEST1", access_token: "EAAsecret", data: [{ event_name: "Schedule" }] });
  });
});
