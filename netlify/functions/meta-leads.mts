import type { Config } from "@netlify/functions";

/** Every minute: asks the app to import new leads from Meta forms (see /api/cron/meta-leads). */
export default async function metaLeads() {
  const base = Netlify.env.get("URL") ?? Netlify.env.get("NEXT_PUBLIC_APP_URL");
  const secret = Netlify.env.get("LH_SERVER_SECRET");
  if (!base || !secret) {
    console.log(JSON.stringify({ job: "meta_leads", skipped: "missing configuration" }));
    return;
  }
  const res = await fetch(new URL("/api/cron/meta-leads", base), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta_leads", status: res.status }));
}

export const config: Config = { schedule: "* * * * *" };
