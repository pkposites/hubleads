import { describe, expect, it } from "vitest";
import { formatWhen, fromLocalInput, localAt, toLocalInput } from "@/lib/format";
import { fillTemplate, formatMinutes, leadsToCsv, type Lead } from "@/lib/leads";

describe("ready-made messages", () => {
  it("fills the first name and the company", () => {
    expect(fillTemplate("Olá, {nome}! Aqui é da {empresa}.", { name: "Maria Souza", company: "Clínica Exen" })).toBe(
      "Olá, Maria! Aqui é da Clínica Exen.",
    );
  });

  it("reads well without a name", () => {
    expect(fillTemplate("Olá, {nome}! Tudo bem?", { name: null, company: "X" })).toBe("Olá! Tudo bem?");
    expect(fillTemplate("Oi {nome}, tudo bem?", { name: "", company: "X" })).toBe("Oi, tudo bem?");
  });
});

describe("attendance formatting", () => {
  it("formats waiting times", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(4.4)).toBe("4 min");
    expect(formatMinutes(125)).toBe("2 h 5 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(3 * 24 * 60)).toBe("3 dias");
  });

  it("converts follow-up dates to and from São Paulo time", () => {
    expect(toLocalInput("2026-09-25T17:30:00Z")).toBe("2026-09-25T14:30");
    expect(fromLocalInput("2026-09-25T14:30")).toBe("2026-09-25T17:30:00.000Z");
    expect(fromLocalInput("amanhã")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("describes when a follow-up is due", () => {
    const now = new Date("2026-09-25T15:00:00Z"); // 12:00 in São Paulo
    expect(formatWhen("2026-09-25T20:00:00Z", now)).toBe("Hoje 17:00");
    expect(formatWhen("2026-09-26T12:00:00Z", now)).toBe("Amanhã 09:00");
    expect(formatWhen("2026-09-24T21:00:00Z", now)).toBe("Ontem 18:00");
    expect(formatWhen("2026-10-02T12:00:00Z", now)).toBe("02/10 09:00");
    expect(localAt(1, 9, now)).toBe("2026-09-26T09:00");
  });

  it("exports follow-up and lost reason columns", () => {
    const csv = leadsToCsv([
      {
        id: "1",
        code: "AB23",
        status: "perdido",
        lost_reason: "Preço",
        next_contact_at: null,
        first_contact_at: null,
        extra: {},
        url_params: {},
        created_at: "2026-09-25T12:00:00Z",
      } as unknown as Lead,
    ]);
    const [header, row] = csv.replace("﻿", "").split("\r\n");
    const cols = header.split(";");
    expect(row.split(";")[cols.indexOf("Motivo da perda")]).toBe("Preço");
  });
});
