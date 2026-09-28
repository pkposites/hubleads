import "server-only";
import { sendLeadConversions } from "@/lib/conversions";
import { decryptSecret } from "@/lib/crypto";
import { call } from "@/lib/db";
import { explainGraphError, fetchLeadsSince, pageToken, parseLead } from "@/lib/meta-leads";
import { notifyNewLead } from "@/lib/push";
import { encryptionKey, serverSecret } from "@/lib/server";

interface DueForm {
  id: string;
  workspace_id: string;
  page_id: string;
  form_id: string;
  cursor_time: number;
  access_token: string;
}

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta_leads", ...entry }));

/**
 * Every minute (netlify/functions/meta-leads.mts): brings the new leads of
 * each connected form into the sheet, notifies the attendants and tells Meta
 * the lead arrived (CRM "Lead" event). Never throws; errors are saved on the
 * form and shown in the panel.
 */
export async function syncMetaForms(deadline: number) {
  const total = { forms: 0, leads: 0, errors: 0 };
  const secret = serverSecret();
  const key = encryptionKey();
  if (!secret || !key) return total;

  const forms = await call<DueForm[]>("lh_server_lead_forms_due", { p_secret: secret, p_limit: 50 });
  const pageTokens = new Map<string, string>();

  for (const form of forms) {
    if (Date.now() > deadline) break;
    total.forms++;
    let cursor = form.cursor_time;
    let error: string | null = null;
    try {
      const token = decryptSecret(form.access_token, key);
      const cacheKey = `${form.workspace_id}:${form.page_id}`;
      let pt = pageTokens.get(cacheKey);
      if (!pt) {
        pt = await pageToken(token, form.page_id);
        pageTokens.set(cacheKey, pt);
      }
      const leads = await fetchLeadsSince(pt, form.form_id, form.cursor_time);
      for (const raw of leads) {
        const lead = parseLead(raw);
        const stored = await call<{ lead_id: string; new: boolean }>("lh_server_meta_form_lead", {
          p_secret: secret,
          p_form: form.id,
          p_lead: lead,
        });
        const created = Math.floor(Date.parse(raw.created_time) / 1000);
        if (Number.isFinite(created)) cursor = Math.max(cursor, created);
        if (stored.new) {
          total.leads++;
          await notifyNewLead(stored.lead_id);
          await sendLeadConversions(stored.lead_id);
        }
        if (Date.now() > deadline) break;
      }
    } catch (e) {
      error = explainGraphError(e);
      total.errors++;
      // Only the kind of error: never the token or lead data.
      log({ form: form.id, error: (e as { code?: number }).code ?? "unknown" });
    }
    await call("lh_server_lead_form_synced", { p_secret: secret, p_form: form.id, p_cursor_time: cursor, p_error: error });
  }
  if (total.forms) log(total);
  return total;
}
