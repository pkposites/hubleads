import { describe, expect, it } from "vitest";
import { dbLimitMb, evaluateInfra, type InfraNumbers } from "@/lib/infra";

const MB = 1024 * 1024;
const today: InfraNumbers = {
  other_tables: 37,
  db_bytes: 15 * MB,
  lh_bytes: 0.84 * MB,
  clients: 1,
  leads: 5,
  events: 95,
  events_7d: 95,
  bytes_per_day: 12_000,
};

describe("when to leave the shared Supabase project", () => {
  it("is calm today, but says the project is shared", () => {
    const s = evaluateInfra(today, 500);
    expect(s).toMatchObject({ level: "ok", shared: true, dbPercent: 3 });
    expect(s.reasons).toEqual([]);
  });

  it("asks for attention with 3 clients or 500 leads", () => {
    expect(evaluateInfra({ ...today, clients: 3 }, 500).level).toBe("atencao");
    expect(evaluateInfra({ ...today, leads: 800 }, 500).reasons[0]).toContain("800 leads");
  });

  it("says it is time to move with 5 clients, a fuller database or space ending soon", () => {
    expect(evaluateInfra({ ...today, clients: 5 }, 500).level).toBe("trocar");
    expect(evaluateInfra({ ...today, db_bytes: 420 * MB }, 500).reasons[0]).toContain("84% do limite");
    const growing = evaluateInfra({ ...today, db_bytes: 400 * MB, bytes_per_day: 5 * MB }, 500);
    expect(growing).toMatchObject({ level: "trocar", daysToLimit: 20 });
  });

  it("only watches space once Lead Hub has its own project", () => {
    const own = evaluateInfra({ ...today, other_tables: 0, clients: 20, leads: 50_000 }, 8192);
    expect(own).toMatchObject({ level: "ok", shared: false });
  });

  it("reads the plan limit from the environment", () => {
    expect(dbLimitMb("8192")).toBe(8192);
    expect(dbLimitMb(undefined)).toBe(500);
    expect(dbLimitMb("abc")).toBe(500);
  });
});
