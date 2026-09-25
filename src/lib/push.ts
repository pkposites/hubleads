import "server-only";
import webpush from "web-push";
import { channelLabel } from "@/lib/attribution";
import { call } from "@/lib/db";
import { serverSecret } from "@/lib/server";

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

interface NewLeadPush {
  slug: string;
  lead: { code: string; name: string | null; channel: string | null; ad: string | null; campaign: string | null };
  targets: { endpoint: string; p256dh: string; auth: string }[];
}

/** Notifies every device subscribed to the lead's client. Never throws. */
export async function notifyNewLead(leadId: string) {
  const config = configured();
  if (!config) return;
  try {
    const push = await call<NewLeadPush | null>("lh_server_new_lead_push", { p_secret: config.secret, p_lead_id: leadId });
    if (!push || push.targets.length === 0) return;

    const origin = [channelLabel(push.lead.channel), push.lead.ad ?? push.lead.campaign].filter(Boolean).join(" · ");
    // The payload is encrypted for each device; nothing here is logged.
    const payload = JSON.stringify({
      title: `Novo lead · ${push.lead.code}`,
      body: `${push.lead.name ?? "Sem nome"}${origin ? ` — ${origin}` : ""}`,
      url: `/w/${push.slug}/atender`,
      tag: `lead-${push.lead.code}`,
    });

    let sent = 0;
    let gone = 0;
    await Promise.all(
      push.targets.map(async (t) => {
        try {
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
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
