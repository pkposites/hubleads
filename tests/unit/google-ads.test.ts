import { describe, expect, it } from "vitest";
import { basicAuth, googleAdsCsv } from "@/lib/google-ads";

describe("Google Ads conversions file", () => {
  it("follows the clicks template, with São Paulo time and value only on sales", () => {
    const csv = googleAdsCsv([
      { gclid: "CjwKCAjw1", name: "Lead Hub - Lead", time: "2026-09-28 10:15:00", value: null },
      { gclid: "CjwKCAjw1", name: "Lead Hub - Venda", time: "2026-09-28 20:50:15", value: 2480 },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Parameters:TimeZone=America/Sao_Paulo",
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
      "CjwKCAjw1,Lead Hub - Lead,2026-09-28 10:15:00,,",
      "CjwKCAjw1,Lead Hub - Venda,2026-09-28 20:50:15,2480.00,BRL",
      "",
    ]);
  });

  it("quotes names with commas and neutralises formulas", () => {
    const csv = googleAdsCsv([{ gclid: "=cmd", name: "Venda, loja", time: "2026-09-28 10:00:00", value: null }]);
    expect(csv).toContain(`'=cmd,"Venda, loja",`);
  });

  it("reads the user and password Google Ads sends", () => {
    const header = `Basic ${Buffer.from("leadhub-ab12cd34:s3nh4:com:dois-pontos").toString("base64")}`;
    expect(basicAuth(header)).toEqual({ username: "leadhub-ab12cd34", password: "s3nh4:com:dois-pontos" });
    expect(basicAuth(null)).toBeNull();
    expect(basicAuth("Bearer x")).toBeNull();
    expect(basicAuth(`Basic ${Buffer.from("semdoispontos").toString("base64")}`)).toBeNull();
  });
});
