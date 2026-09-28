import { describe, expect, it, vi } from "vitest";
import { dueEvents, sendMetaEvent, sha256, type MetaConfig, type MetaLead } from "@/lib/meta";
import { explainGraphError, fetchLeadsSince, GraphError, listForms, parseLead, questionLabel } from "@/lib/meta-leads";

const config: MetaConfig = { pixel_id: "123456789", access_token: "EAAsecret", test_event_code: null, send_schedule: true, send_purchase: true };
const NOW = new Date("2026-09-28T15:00:00Z");

const formLead = (patch: Partial<MetaLead> = {}): MetaLead => ({
  id: "lead-1",
  workspace_id: "ws-1",
  visitor_id: null,
  status: "novo",
  name: "Ana Paula Souza",
  phone: "+5511912345678",
  sale_value: null,
  fbc: null,
  fbp: null,
  ip_address: null,
  user_agent: null,
  landing_url: null,
  source: "meta_form",
  meta_lead_id: "9876543210987654321",
  email: "Ana@Email.com",
  created_at: "2026-09-28T12:00:00Z",
  ...patch,
});

describe("reading a lead from a Meta form", () => {
  it("takes name, phone and e-mail and keeps the other answers as columns", () => {
    const lead = parseLead({
      id: "120000000000001",
      created_time: "2026-09-28T12:00:00+0000",
      field_data: [
        { name: "full_name", values: ["Ana Paula Souza"] },
        { name: "phone_number", values: ["+55 11 91234-5678"] },
        { name: "email", values: ["Ana@Email.com"] },
        { name: "qual_o_seu_orçamento?", values: ["R$ 500 mil a 1 milhão"] },
        { name: "city", values: ["São Paulo"] },
      ],
      campaign_name: "Kaslic Ibirapuera",
      adset_name: "Moema 35+",
      ad_name: "Vídeo decorado",
      platform: "ig",
      is_organic: false,
    });
    expect(lead).toMatchObject({
      meta_lead_id: "120000000000001",
      name: "Ana Paula Souza",
      phone: "+5511912345678",
      email: "ana@email.com",
      campaign_name: "Kaslic Ibirapuera",
      platform: "ig",
      is_organic: false,
    });
    expect(lead.answers).toEqual({ "Qual o seu orçamento?": "R$ 500 mil a 1 milhão", Cidade: "São Paulo", "E-mail": "ana@email.com" });
  });

  it("joins first and last name and keeps odd phones as typed digits", () => {
    const lead = parseLead({
      id: "1200000000002",
      created_time: "2026-09-28T12:00:00+0000",
      field_data: [
        { name: "first_name", values: ["Ana"] },
        { name: "last_name", values: ["Souza"] },
        { name: "phone_number", values: ["12 34"] },
      ],
    });
    expect(lead.name).toBe("Ana Souza");
    expect(lead.phone).toBe("1234");
    expect(questionLabel("zip_code")).toBe("CEP");
  });
});

describe("CRM events for form leads", () => {
  it("sends Lead when it arrives, then Schedule and Purchase, with the Meta lead id", () => {
    const [lead] = dueEvents(formLead(), config, [], NOW);
    expect(lead).toMatchObject({
      event_name: "Lead",
      event_time: Math.floor(Date.parse("2026-09-28T12:00:00Z") / 1000),
      action_source: "system_generated",
      custom_data: { event_source: "crm", lead_event_source: "Lead Hub" },
    });
    expect(lead.user_data).toEqual({
      lead_id: "9876543210987654321",
      ph: [sha256("5511912345678")],
      em: [sha256("ana@email.com")],
      fn: [sha256("ana")],
      ln: [sha256("souza")],
    });

    const sale = dueEvents(formLead({ status: "venda", sale_value: "850000" }), config, ["Lead"], NOW, "2026-09-28T14:00:00Z");
    expect(sale.map((e) => [e.event_name, e.custom_data])).toEqual([
      ["Purchase", { event_source: "crm", lead_event_source: "Lead Hub", currency: "BRL", value: 850000 }],
    ]);
    const booked = dueEvents(formLead({ status: "agendado" }), config, ["Lead"], NOW, "2026-09-28T14:00:00Z");
    expect(booked.map((e) => e.event_name)).toEqual(["Schedule"]);
  });

  it("does not send Lead again, nor leads older than 7 days", () => {
    expect(dueEvents(formLead(), config, ["Lead"], NOW)).toEqual([]);
    expect(dueEvents(formLead({ created_at: "2026-09-01T12:00:00Z" }), config, [], NOW)).toEqual([]);
  });

  it("writes lead_id as a number, without losing digits", async () => {
    const fetchMock = vi.fn(async () => new Response('{"events_received":1}'));
    const [event] = dueEvents(formLead(), config, [], NOW);
    await sendMetaEvent(config, event, fetchMock as unknown as typeof fetch);
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain('"lead_id":9876543210987654321');
  });
});

describe("Graph API calls", () => {
  it("pages through the leads after the cursor, oldest first, with the token only in the header", async () => {
    const calls: { url: URL; auth: string | null }[] = [];
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      const page2 = url.searchParams.get("after") === "c1";
      return new Response(
        JSON.stringify({
          data: page2 ? [{ id: "1", created_time: "2026-09-28T10:00:00+0000" }] : [{ id: "2", created_time: "2026-09-28T11:00:00+0000" }],
          paging: page2 ? {} : { cursors: { after: "c1" }, next: "https://graph/next" },
        }),
      );
    });
    const leads = await fetchLeadsSince("PAGE_TOKEN", "555000", 1759000000, 500, fetchMock as unknown as typeof fetch);
    expect(leads.map((l) => l.id)).toEqual(["1", "2"]);
    expect(calls[0].url.pathname).toMatch(/\/555000\/leads$/);
    expect(JSON.parse(calls[0].url.searchParams.get("filtering")!)).toEqual([{ field: "time_created", operator: "GREATER_THAN", value: 1759000000 }]);
    expect(calls.every((c) => c.auth === "Bearer PAGE_TOKEN" && !c.url.toString().includes("PAGE_TOKEN"))).toBe(true);
  });

  it("explains Meta errors in Portuguese, never with the token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Invalid OAuth access token SECRET_TOKEN", code: 190 } }), { status: 400 }),
    );
    const error = await listForms("SECRET_TOKEN", "310343358836414", fetchMock as unknown as typeof fetch).catch((e) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error.message).not.toContain("SECRET_TOKEN");
    expect(explainGraphError(error)).toMatch(/Token inválido ou expirado/);
    expect(explainGraphError(new GraphError("x", 200))).toMatch(/leads_retrieval/);
  });
});
