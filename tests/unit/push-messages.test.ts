import { describe, expect, it } from "vitest";
import { newLeadMessages } from "@/lib/push-messages";

describe("new-lead notices", () => {
  const base = { slug: "ludleads", workspace_id: "ws-1", company: "Ludmilla" };

  it("the admin notice names the client and opens it; the team's opens the queue", () => {
    const m = newLeadMessages({ ...base, lead: { code: "AB12", name: "Carla", channel: "meta_ads", source: "meta_form", ad: "Vídeo", campaign: null } });
    expect(m.admin).toEqual({ title: "Novo lead · Ludmilla", body: "Carla — Formulário Meta · Vídeo", url: "/admin/clientes/ws-1", tag: "lead-AB12" });
    expect(m.client).toMatchObject({ title: "Novo lead · AB12", url: "/w/ludleads/atender", body: "Carla — Formulário Meta · Vídeo" });
  });

  it("landing page leads show the channel; no name is written as such", () => {
    const m = newLeadMessages({ ...base, lead: { code: "CD34", name: null, channel: "meta_ads", source: "lp", ad: null, campaign: "Kaslic" } });
    expect(m.admin.body).toBe("Sem nome — Meta Ads · Kaslic");
  });
});
