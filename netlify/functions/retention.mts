import type { Config } from "@netlify/functions";

/**
 * LGPD retention, once a day: deletes leads and page events older than each
 * client's retention period and clears IP/browser after 90 days (see
 * lh_server_apply_retention). Logs only counts.
 */
export default async function retention() {
  const url = Netlify.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const key = Netlify.env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? Netlify.env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secret = Netlify.env.get("LH_SERVER_SECRET");
  if (!url || !key || !secret) {
    console.log(JSON.stringify({ job: "retention", skipped: "missing configuration" }));
    return;
  }
  const res = await fetch(`${url}/rest/v1/rpc/lh_server_apply_retention`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret }),
  });
  const body = res.ok ? await res.json() : { error: res.status };
  console.log(JSON.stringify({ ts: new Date().toISOString(), job: "retention", ...body }));
}

// 03:10 in São Paulo.
export const config: Config = { schedule: "10 6 * * *" };
