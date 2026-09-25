import type { Config } from "@netlify/functions";

/** Every hour: asks the app to resend conversions Meta still owes (see /api/cron/meta-retry). */
export default async function metaRetry() {
  const base = Netlify.env.get("URL") ?? Netlify.env.get("NEXT_PUBLIC_APP_URL");
  const secret = Netlify.env.get("LH_SERVER_SECRET");
  if (!base || !secret) {
    console.log(JSON.stringify({ job: "meta_retry", skipped: "missing configuration" }));
    return;
  }
  const res = await fetch(new URL("/api/cron/meta-retry", base), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(25_000),
  });
  console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta_retry", status: res.status }));
}

export const config: Config = { schedule: "@hourly" };
