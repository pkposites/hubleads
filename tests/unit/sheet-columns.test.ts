import { describe, expect, it } from "vitest";
import { leadsToCsv, type Lead } from "@/lib/leads";
import { answerValue, dataColumns, resolveColumns, showsFixed } from "@/lib/sheet-columns";

describe("sheet columns", () => {
  it("keeps the saved order, adds new answers at the end and the standard columns last", () => {
    const columns = resolveColumns(
      [
        { key: "Bairro", label: "Região", kind: "answer", hidden: false },
        { key: "Renda", label: "Renda", kind: "custom", hidden: false },
        { key: "E-mail", label: "", kind: "answer", hidden: true },
        { key: "page", label: "", kind: "fixed", hidden: true },
        { key: "nao_existe", label: "", kind: "fixed", hidden: true },
      ],
      [{ key: "E-mail" }, { key: "qual_o_prazo" }, { key: "Bairro" }],
    );
    expect(columns.map((c) => [c.key, c.label])).toEqual([
      ["Bairro", "Região"],
      ["Renda", "Renda"],
      ["E-mail", "E-mail"],
      ["page", "Página"],
      ["qual_o_prazo", "Qual o prazo"],
      ["lp_events", "Eventos na LP"],
      ["origin", "Origem"],
      ["campaign", "Campanha"],
      ["adset", "Conjunto"],
      ["ad", "Anúncio"],
      ["device", "Dispositivo"],
      ["clicks", "Cliques"],
      ["notes", "Observações"],
    ]);
    expect(dataColumns(columns).map((c) => c.key)).toEqual(["Bairro", "Renda", "qual_o_prazo"]);
    expect(showsFixed(columns, "page")).toBe(false);
    expect(showsFixed(columns, "campaign")).toBe(true);
  });

  it("shows Meta's option values as text", () => {
    expect(answerValue("comprar_para_morar")).toBe("Comprar para morar");
    expect(answerValue("recursos_próprios_/_sinal_à_vista")).toBe("Recursos próprios / sinal à vista");
    expect(answerValue("Até R$ 800 mil")).toBe("Até R$ 800 mil");
    expect(answerValue("joao_silva@email.com")).toBe("joao_silva@email.com");
    expect(answerValue("investir")).toBe("Investir");
    expect(answerValue("https://x.com/a_b")).toBe("https://x.com/a_b");
    expect(answerValue("150000")).toBe("150000");
    expect(answerValue(true)).toBe("Sim");
    expect(answerValue(null)).toBe("");
  });

  it("exports answers with the client's names and order, hidden ones included", () => {
    const lead = { extra: { Bairro: "Moema", "E-mail": "a@b.com", outra: "x_y" }, source: "sheets", status: "novo" } as unknown as Lead;
    const csv = leadsToCsv([lead], resolveColumns([
      { key: "E-mail", label: "Email", kind: "answer", hidden: true },
      { key: "Bairro", label: "Região", kind: "answer", hidden: false },
    ]));
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header.split(";").slice(-3)).toEqual(["Email", "Região", "Outra"]);
    expect(row.split(";").slice(-3)).toEqual(["a@b.com", "Moema", "X y"]);
  });
});
