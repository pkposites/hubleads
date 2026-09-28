import { channelLabel } from "@/lib/attribution";
import { sourceLabel } from "@/lib/source-labels";

export interface NewLeadInfo {
  slug: string;
  workspace_id: string;
  company: string;
  lead: { code: string; name: string | null; channel: string | null; source: string; ad: string | null; campaign: string | null };
}

/** The two notices of a new lead: for the client's team and for the admins. */
export function newLeadMessages(push: NewLeadInfo) {
  const origin = [push.lead.source === "lp" ? channelLabel(push.lead.channel) : sourceLabel(push.lead.source), push.lead.ad ?? push.lead.campaign]
    .filter(Boolean)
    .join(" · ");
  const body = `${push.lead.name ?? "Sem nome"}${origin ? ` — ${origin}` : ""}`;
  return {
    client: { title: `Novo lead · ${push.lead.code}`, body, url: `/w/${push.slug}/atender`, tag: `lead-${push.lead.code}` },
    admin: { title: `Novo lead · ${push.company}`, body, url: `/admin/clientes/${push.workspace_id}`, tag: `lead-${push.lead.code}` },
  };
}

