import "server-only";
import webpush from "web-push";
import { call } from "@/lib/db";
import { serverSecret } from "@/lib/server";
import { newLeadMessages, type NewLeadInfo } from "@/lib/push-messages";

// Read at request time (a literal process.env.NEXT_PUBLIC_* would be fixed at build time).
const PUBLIC_KEY_VAR = "NEXT_PUBLIC_VAPID_PUBLIC_KEY";
export const vapidPublicKey = () => process.env[PUBLIC_KEY_VAR] || null;

function configured() {
  const secret = serverSecret();
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!secret || !publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT || process.env.NEXT_PUBLIC_APP_URL || "https://leadinghub.netlify.app";
  return { secret, vapid: { subject, publicKey, privateKey } };
}

interface NewLeadPush extends NewLeadInfo {
  /** "client": the client's devices; "admin": masters and the gestor who owns the client. */
  targets: { kind: "client" | "admin"; endpoint: string; p256dh: string; auth: string }[];
}

/** Notifies the client's devices and the admins' devices. Never throws. */
export async function notifyNewLead(leadId: string) {
  const config = configured();
  if (!config) return;
  try {
    const push = await call<NewLeadPush | null>("lh_server_new_lead_push", { p_secret: config.secret, p_lead_id: leadId });
    if (!push || push.targets.length === 0) return;

    // The payload is encrypted for each device; nothing here is logged.
    const messages = newLeadMessages(push);
    const payloads = { client: JSON.stringify(messages.client), admin: JSON.stringify(messages.admin) };

    let sent = 0;
    let gone = 0;
    await Promise.all(
      push.targets.map(async (t) => {
        try {
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payloads[t.kind] ?? payloads.client, {
            vapidDetails: config.vapid,
            TTL: 60 * 60,
            urgency: "high",
          });
          sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone++;
            await call("lh_server_push_gone", { p_secret: config.secret, p_endpoint: t.endpoint }).catch(() => undefined);
          }
        }
      }),
    );
    console.log(JSON.stringify({ ts: new Date().toISOString(), job: "push", sent, gone, targets: push.targets.length }));
  } catch (error) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), job: "push", error: (error as { code?: string }).code ?? "unknown" }));
  }
}
