import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { call } from "@/lib/db";
import { dueEvents, sendMetaEvent, sha256, type MetaConfig, type MetaEvent, type MetaLead } from "@/lib/meta";
import { encryptionKey, serverSecret } from "@/lib/server";

/** The stored config with its token decrypted, or null when the key is missing or wrong. */
function withPlainToken<T extends { access_token: string }>(config: T): T | null {
  const key = encryptionKey();
  if (!key) return null;
  try {
    return { ...config, access_token: decryptSecret(config.access_token, key) };
  } catch {
    return null;
  }
}

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

/**
 * Sends the conversions a lead is due (once each). Never throws. Failures are
 * recorded and retried every hour by /api/cron/meta-retry.
 */
export async function sendLeadConversions(leadId: string): Promise<{ sent: number; failed: number }> {
  const outcome = { sent: 0, failed: 0 };
  const secret = serverSecret();
  if (!secret) return outcome;
  try {
    const payload = await call<{ config: MetaConfig; lead: MetaLead; sent: string[]; status_at: string | null } | null>(
      "lh_server_meta_payload",
      { p_secret: secret, p_lead_id: leadId },
    );
    if (!payload) return outcome;
    const events = dueEvents(payload.lead, payload.config, payload.sent, new Date(), payload.status_at);
    if (events.length === 0) return outcome;
    const config = withPlainToken(payload.config);
    if (!config) {
      log({ error: "token_key" });
      return outcome;
    }
    for (const event of events) {
      const result = await sendMetaEvent(config, event);
      await record(secret, payload.lead.workspace_id, leadId, event, Boolean(payload.config.test_event_code), result);
      if (result.ok) outcome.sent++;
      else outcome.failed++;
      log({ event: event.event_name, ok: result.ok });
    }
  } catch (error) {
    log({ error: (error as { code?: string }).code ?? "unknown" });
  }
  return outcome;
}

/** Hourly: resends what Meta still owes (failures, or bookings made while sending was off). */
export async function retryPendingConversions(deadline: number) {
  const secret = serverSecret();
  const total = { leads: 0, sent: 0, failed: 0 };
  if (!secret) return total;
  const pending = await call<string[]>("lh_server_meta_pending", { p_secret: secret, p_limit: 20 });
  for (const leadId of pending) {
    if (Date.now() > deadline) break;
    const r = await sendLeadConversions(leadId);
    total.leads++;
    total.sent += r.sent;
    total.failed += r.failed;
  }
  log({ job: "meta_retry", ...total, pending: pending.length });
  return total;
}

/** Admin "send test event": uses the test code so nothing counts in the ads. */
export async function sendTestConversion(workspaceId: string, context: { ip?: string; userAgent?: string }) {
  const secret = serverSecret();
  if (!secret) return { ok: false, response: "LH_SERVER_SECRET não configurado no servidor." };
  const stored = await call<(MetaConfig & { workspace_id: string }) | null>("lh_server_meta_config", {
    p_secret: secret,
    p_workspace_id: workspaceId,
  });
  if (!stored) return { ok: false, response: "Salve o pixel e o token primeiro." };
  const config = withPlainToken(stored);
  if (!config) return { ok: false, response: "Não foi possível ler o token: confira LH_ENCRYPTION_KEY no servidor e salve o token de novo." };
  if (!config.test_event_code) return { ok: false, response: "Informe o código de teste (Gerenciador de Eventos → Testar eventos)." };
  const event: MetaEvent = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `teste.${Date.now()}`,
    action_source: "chat",
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
