import { describe, expect, it } from "vitest";
import { answerEntries, answerLabel, leadsToCsv, parseMoney, periodStart, type Lead } from "@/lib/leads";

describe("parseMoney", () => {
  it.each([
    ["18.000,50", 18000.5],
    ["R$ 18.000", 18000],
    ["18000.5", 18000.5],
    ["", null],
    ["abc", "invalid"],
    ["-5", "invalid"],
  ])("%j -> %j", (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });
});

describe("periodStart", () => {
  const now = new Date("2026-09-24T02:00:00Z"); // 23:00 of the 23rd in São Paulo
  it("starts 'hoje' at midnight in São Paulo", () => {
    expect(periodStart("hoje", now)?.toISOString()).toBe("2026-09-23T03:00:00.000Z");
  });
  it("counts days back for 7d/30d and has no start for 'tudo'", () => {
    expect(periodStart("7d", now)?.toISOString()).toBe("2026-09-17T02:00:00.000Z");
    expect(periodStart("tudo", now)).toBeNull();
  });
});

describe("leadsToCsv", () => {
  const lead = {
    created_at: "2026-09-24T12:00:00Z",
    code: "7F3K",
    name: 'Maria "Mah"; Souza',
    phone: "+5511999990000",
    status: "venda",
    sale_value: 18000,
    notes: "=HYPERLINK(\"http://x\")",
    channel: "meta_ads",
    source: "lp",
    clicks: 2,
  } as unknown as Lead;

  it("writes a BOM, semicolons, quoted cells and Portuguese labels", () => {
    const csv = leadsToCsv([lead]);
    expect(csv.startsWith("﻿Data/hora do clique;Código;Nome;Telefone;Status")).toBe(true);
    const row = csv.split("\r\n")[1];
    expect(row).toContain('"Maria ""Mah""; Souza"');
    expect(row).toContain(";Venda;18000;");
    expect(row).toContain(";Meta Ads;");
  });

  it("neutralises formulas", () => {
    expect(leadsToCsv([lead])).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe("quiz answers", () => {
  it("lists page answers without internal keys and labels them", () => {
    expect(answerEntries({ whatsapp_url: "https://wa.me/1", tempo_de_queda: "5 anos", ja_fez: false, vazio: "" })).toEqual([
      ["tempo_de_queda", "5 anos"],
      ["ja_fez", "Não"],
    ]);
    expect(answerLabel("tempo_de_queda")).toBe("Tempo de queda");
  });

  it("adds one CSV column per answer key", () => {
    const base = { created_at: "2026-09-24T12:00:00Z", code: "A", status: "novo", source: "lp", clicks: 1 };
    const csv = leadsToCsv([
      { ...base, extra: { tempo_de_queda: "5 anos" } },
      { ...base, code: "B", extra: { investimento: "R$ 20 mil", whatsapp_url: "x" } },
    ] as unknown as Lead[]);
    const [header, a, b] = csv.replace("\uFEFF", "").split("\r\n");
    expect(header.endsWith(";Tempo de queda;Investimento")).toBe(true);
    expect(a.endsWith(";5 anos;")).toBe(true);
    expect(b.endsWith(";;R$ 20 mil")).toBe(true);
  });
});

describe("conversion rate", () => {
  it("is a share of people, capped at 100% and empty without visitors", async () => {
    const { rate, formatRate } = await import("@/lib/leads");
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(5, 4)).toBe(100);
    expect(rate(0, 0)).toBeNull();
    expect(formatRate(33.3)).toBe("33,3%");
    expect(formatRate(null)).toBe("—");
  });
});
