import "server-only";
import { call } from "@/lib/db";
import { dueEvents, sendMetaEvent, sha256, type MetaConfig, type MetaEvent, type MetaLead } from "@/lib/meta";
import { serverSecret } from "@/lib/server";

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta", ...entry }));

async function record(secret: string, workspaceId: string, leadId: string | null, event: MetaEvent, test: boolean, result: { ok: boolean; response: string }) {
  await call("lh_server_meta_log", {
    p_secret: secret,
    p_workspace_id: workspaceId,
    p_lead_id: leadId,
    p_event_name: event.event_name,
    p_event_id: event.event_id,
    p_ok: result.ok,
    p_test: test,
    p_response: result.response,
  });
}

/** Sends the conversions a lead is due (once each). Never throws. */
export async function sendLeadConversions(leadId: string) {
  const secret = serverSecret();
  if (!secret) return;
  try {
    const payload = await call<{ config: MetaConfig; lead: MetaLead; sent: string[] } | null>("lh_server_meta_payload", {
      p_secret: secret,
      p_lead_id: leadId,
    });
    if (!payload) return;
    for (const event of dueEvents(payload.lead, payload.config, payload.sent)) {
      const result = await sendMetaEvent(payload.config, event);
      await record(secret, payload.lead.workspace_id, leadId, event, Boolean(payload.config.test_event_code), result);
      log({ event: event.event_name, ok: result.ok });
    }
  } catch (error) {
    log({ error: (error as { code?: string }).code ?? "unknown" });
  }
}

/** Admin "send test event": uses the test code so nothing counts in the ads. */
export async function sendTestConversion(workspaceId: string, context: { ip?: string; userAgent?: string; url: string }) {
  const secret = serverSecret();
  if (!secret) return { ok: false, response: "LH_SERVER_SECRET não configurado no servidor." };
  const config = await call<(MetaConfig & { workspace_id: string }) | null>("lh_server_meta_config", {
    p_secret: secret,
    p_workspace_id: workspaceId,
  });
  if (!config) return { ok: false, response: "Salve o pixel e o token primeiro." };
  if (!config.test_event_code) return { ok: false, response: "Informe o código de teste (Gerenciador de Eventos → Testar eventos)." };
  const event: MetaEvent = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `teste.${Date.now()}`,
    action_source: "website",
    event_source_url: context.url,
    user_data: {
      external_id: [sha256("lead-hub-teste")],
      ...(context.ip && { client_ip_address: context.ip }),
      client_user_agent: context.userAgent ?? "Lead Hub",
    },
  };
  const result = await sendMetaEvent(config, event);
  await record(secret, workspaceId, null, event, true, result);
  return result;
}
