import { describe, expect, it } from "vitest";
import { countTrend, formatRange, periodArgs, rateTrend, resolvePeriod } from "@/lib/period";

// 27/09/2026 at 22:30 in São Paulo (01:30 UTC of the 28th): the day must be
// taken in Brazil, not in UTC.
const NOW = new Date("2026-09-28T01:30:00Z");
const days = (p: { from: string | null; to: string | null } | null) => (p ? [p.from, p.to] : null);

describe("resolvePeriod", () => {
  it("uses whole days in São Paulo, from midnight to midnight", () => {
    const p = resolvePeriod({ periodo: "hoje" }, NOW);
    expect(days(p)).toEqual(["2026-09-27", "2026-09-27"]);
    expect(periodArgs(p)).toEqual({ p_since: "2026-09-27T03:00:00.000Z", p_until: "2026-09-28T03:00:00.000Z" });
    expect(p.previous).toBeNull();
  });

  it("compares each period with the same length right before", () => {
    const ontem = resolvePeriod({ periodo: "ontem" }, NOW);
    expect([days(ontem), days(ontem.previous)]).toEqual([
      ["2026-09-26", "2026-09-26"],
      ["2026-09-25", "2026-09-25"],
    ]);
    const week = resolvePeriod({ periodo: "7d" }, NOW);
    expect([days(week), days(week.previous)]).toEqual([
      ["2026-09-21", "2026-09-27"],
      ["2026-09-14", "2026-09-20"],
    ]);
    const month = resolvePeriod({ periodo: "30d" }, NOW);
    expect([days(month), days(month.previous)]).toEqual([
      ["2026-08-29", "2026-09-27"],
      ["2026-07-30", "2026-08-28"],
    ]);
  });

  it("'Este mês' compares with the same days of last month; 'Mês passado' with the month before", () => {
    const mes = resolvePeriod({ periodo: "mes" }, NOW);
    expect([days(mes), days(mes.previous)]).toEqual([
      ["2026-09-01", "2026-09-27"],
      ["2026-08-01", "2026-08-27"],
    ]);
    // On 31 March, last month (February) stops at its own end.
    const march = resolvePeriod({ periodo: "mes" }, new Date("2026-03-31T15:00:00Z"));
    expect(days(march.previous)).toEqual(["2026-02-01", "2026-02-28"]);

    const passado = resolvePeriod({ periodo: "mes_passado" }, NOW);
    expect([days(passado), days(passado.previous)]).toEqual([
      ["2026-08-01", "2026-08-31"],
      ["2026-07-01", "2026-07-31"],
    ]);
    const january = resolvePeriod({ periodo: "mes_passado" }, new Date("2026-01-10T15:00:00Z"));
    expect(days(january)).toEqual(["2025-12-01", "2025-12-31"]);
  });

  it("custom range: both days included, fixed when inverted, never in the future", () => {
    const p = resolvePeriod({ periodo: "personalizado", de: "2026-09-10", ate: "2026-09-01" }, NOW);
    expect(days(p)).toEqual(["2026-09-01", "2026-09-10"]);
    expect(days(p.previous)).toEqual(["2026-08-22", "2026-08-31"]);
    expect(p.query).toEqual({ periodo: "personalizado", de: "2026-09-01", ate: "2026-09-10" });

    expect(days(resolvePeriod({ periodo: "personalizado", de: "2026-09-20", ate: "2027-01-01" }, NOW))).toEqual(["2026-09-20", "2026-09-27"]);
    expect(days(resolvePeriod({ periodo: "personalizado", de: "2026-09-05" }, NOW))).toEqual(["2026-09-05", "2026-09-05"]);
    // Invalid dates fall back to the default period.
    expect(resolvePeriod({ periodo: "personalizado", de: "2026-02-30" }, NOW).key).toBe("30d");
  });

  it("'Tudo' has no limits and no comparison; unknown values use the default", () => {
    const all = resolvePeriod({ periodo: "tudo" }, NOW);
    expect(periodArgs(all)).toEqual({ p_since: null, p_until: null });
    expect(all.previous).toBeNull();
    expect(resolvePeriod({ periodo: "xyz" }, NOW).key).toBe("30d");
    expect(resolvePeriod({}, NOW).key).toBe("30d");
  });
});

describe("formatRange", () => {
  it("writes the days in Portuguese, with the year only when needed", () => {
    expect(formatRange({ since: null, until: null, from: "2026-09-27", to: "2026-09-27" }, NOW)).toBe("27 de set.");
    expect(formatRange({ since: null, until: null, from: "2026-09-01", to: "2026-09-27" }, NOW)).toBe("1 a 27 de set.");
    expect(formatRange({ since: null, until: null, from: "2026-08-29", to: "2026-09-27" }, NOW)).toBe("29 de ago. a 27 de set.");
    expect(formatRange({ since: null, until: null, from: "2025-12-01", to: "2025-12-31" }, NOW)).toBe("1 a 31 de dez. de 2025");
    expect(formatRange({ since: null, until: null, from: "2025-12-20", to: "2026-01-05" }, NOW)).toBe("20 de dez. de 2025 a 5 de jan. de 2026");
  });
});

describe("trends", () => {
  it("counts change in percent; rates in percentage points", () => {
    expect(countTrend(112, 100)).toEqual({ text: "▲ 12%", direction: "up" });
    expect(countTrend(92, 100)).toEqual({ text: "▼ 8%", direction: "down" });
    expect(countTrend(5, 0)).toEqual({ text: "▲ novo", direction: "up" });
    expect(countTrend(0, 0)).toBeNull();
    expect(countTrend(10, 10)).toEqual({ text: "= igual", direction: "same" });
    expect(rateTrend(8.2, 6.8)).toEqual({ text: "▲ 1,4 p.p.", direction: "up" });
    expect(rateTrend(5, 7.5)).toEqual({ text: "▼ 2,5 p.p.", direction: "down" });
    expect(rateTrend(null, 5)).toBeNull();
  });
});
