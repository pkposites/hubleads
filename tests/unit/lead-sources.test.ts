import { describe, expect, it } from "vitest";
import { appsScript, headerKey, mapSheetRow } from "@/lib/lead-sources";
import { sourceLabel } from "@/lib/source-labels";

describe("rows from Google Sheets", () => {
  it("reads the columns Meta's form integration writes (with its l:/p:/c: prefixes)", () => {
    const lead = mapSheetRow(
      {
        id: "l:1234567890123456",
        created_time: "2026-09-28T09:15:00-03:00",
        ad_id: "ag:120200000000001",
        ad_name: "Vídeo decorado",
        adset_id: "as:120200000000002",
        adset_name: "Moema 35+",
        campaign_id: "c:120200000000003",
        campaign_name: "Kaslic Ibirapuera",
        form_id: "f:778899001122",
        form_name: "Kaslic Ibirapuera - 01/09",
        is_organic: "false",
        platform: "ig",
        "qual_a_faixa_de_valor_do_imóvel?": "Até R$ 800 mil",
        full_name: "Carla Mendes",
        phone_number: "p:+5511988881111",
        email: "Carla@Email.com",
        lead_status: "CREATED",
      },
      "src-1",
    );
    expect(lead).toEqual({
      meta_lead_id: "1234567890123456",
      external_id: null,
      created_time: "2026-09-28T12:15:00.000Z",
      name: "Carla Mendes",
      phone: "+5511988881111",
      email: "carla@email.com",
      answers: { "Qual a faixa de valor do imóvel?": "Até R$ 800 mil", "E-mail": "carla@email.com" },
      ad_id: "120200000000001",
      ad_name: "Vídeo decorado",
      adset_id: "120200000000002",
      adset_name: "Moema 35+",
      campaign_id: "120200000000003",
      campaign_name: "Kaslic Ibirapuera",
      form_id: "778899001122",
      form_name: "Kaslic Ibirapuera - 01/09",
      platform: "ig",
      is_organic: false,
    });
  });

  it("reads Portuguese headers of any other sheet, and recognises the same row sent twice", () => {
    const row = { "Carimbo de data/hora": "2026-09-28 10:00", Nome: "Bruno Lima", "Telefone (WhatsApp)": "(11) 97777-2222", "Qual o bairro?": "Moema" };
    const lead = mapSheetRow(row, "src-1")!;
    expect(lead).toMatchObject({ meta_lead_id: null, name: "Bruno Lima", answers: { "Qual o bairro?": "Moema" } });
    expect(lead.external_id).toMatch(/^row:[0-9a-f]{40}$/);
    expect(mapSheetRow(row, "src-1")!.external_id).toBe(lead.external_id);
    expect(mapSheetRow(row, "src-2")!.external_id).not.toBe(lead.external_id);
  });

  it("recognises common phone headers and ignores empty rows", () => {
    expect(mapSheetRow({ nome: "Ana", whatsapp: "11 91234-5678" }, "s")?.phone).toBe("+5511912345678");
    expect(mapSheetRow({ "Qual o bairro?": "Moema" }, "s")).toBeNull();
    expect(mapSheetRow({}, "s")).toBeNull();
    expect(headerKey(" E-mail do Cliente ")).toBe("e_mail_do_cliente");
    expect(sourceLabel("meta_form")).toBe("Formulário Meta");
    expect(sourceLabel("xyz")).toBe("Outra");
  });
});

describe("Apps Script for the sheet", () => {
  it("has the address and key filled in and is valid JavaScript", () => {
    const script = appsScript("https://cadeolead.com.br/api/sources/sheets", "lhs_" + "a".repeat(48));
    expect(script).toContain('const LEAD_HUB_URL = "https://cadeolead.com.br/api/sources/sheets";');
    expect(script).toContain(`const LEAD_HUB_KEY = "lhs_${"a".repeat(48)}";`);
    expect(() => new Function(script)).not.toThrow();
    for (const fn of ["function instalar()", "function importarTudo()", "function enviarLeads()"]) expect(script).toContain(fn);
  });
});
