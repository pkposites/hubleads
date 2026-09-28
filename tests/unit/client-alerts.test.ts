import { describe, expect, it } from "vitest";
import { alertSignature, clientActivity, formatIdle, idleClients } from "@/lib/client-alerts";

const now = new Date("2026-09-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const client = (over: Partial<Parameters<typeof clientActivity>[0]>) => ({
  id: "c",
  name: "Cliente",
  created_at: hoursAgo(24 * 30),
  last_lead_at: null,
  last_event_at: null,
  ...over,
});

describe("activity of a client", () => {
  it("leads from a sheet or form count, not only landing page events", () => {
    expect(clientActivity(client({ last_lead_at: hoursAgo(5) }), now)).toBe("recebendo");
    expect(clientActivity(client({ last_event_at: hoursAgo(5) }), now)).toBe("recebendo");
    expect(clientActivity(client({ last_lead_at: hoursAgo(24 * 4) }), now)).toBe("parado");
    expect(clientActivity(client({}), now)).toBe("aguardando");
  });
});

describe("clients without leads for more than 20 h", () => {
  it("lists them longest first, including new clients that never had one", () => {
    const list = idleClients(
      [
        client({ id: "a", name: "Recente", last_lead_at: hoursAgo(3) }),
        client({ id: "b", name: "Parado", last_lead_at: hoursAgo(26) }),
        client({ id: "c", name: "Nunca", created_at: hoursAgo(80) }),
        client({ id: "d", name: "Novo", created_at: hoursAgo(2) }),
        client({ id: "e", name: "No limite", last_lead_at: hoursAgo(20) }),
      ],
      now,
    );
    expect(list.map((c) => [c.name, c.hours])).toEqual([
      ["Nunca", 80],
      ["Parado", 26],
    ]);
    expect(formatIdle(26)).toBe("26 h");
    expect(formatIdle(80)).toBe("3 dias e 8 h");
    expect(formatIdle(72)).toBe("3 dias");
  });

  it("the signature changes when the situation changes", () => {
    expect(alertSignature([["b", "x"]])).toBe(alertSignature([["b", "x"]]));
    expect(alertSignature([["b", "x"]])).not.toBe(alertSignature([["b", "y"]]));
    expect(alertSignature([["b", "x"]])).toMatch(/^[0-9a-f]{12}$/);
  });
});
