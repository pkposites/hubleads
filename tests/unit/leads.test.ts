import { describe, expect, it } from "vitest";
import { leadsToCsv, parseMoney, periodStart, type Lead } from "@/lib/leads";

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
