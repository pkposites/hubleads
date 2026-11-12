import type { Config } from "@netlify/functions";

/** Every hour: asks the app to resend conversions Meta still owes (see /api/cron/meta-retry). */
export default async function metaRetry() {
  const base = Netlify.env.get("URL") ?? Netlify.env.get("NEXT_PUBLIC_APP_URL");
  const secret = Netlify.env.get("LH_SERVER_SECRET");
  if (!base || !secret) {
    console.log(JSON.stringify({ job: "meta_retry", skipped: "missing configuration" }));
    return;
  }
  const call = () =>
    fetch(new URL("/api/cron/meta-retry", base), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(25_000),
    });
  // The call to the app itself fails now and then (network): one more try,
  // then a log line instead of a crashed run.
  let res: Response;
  try {
    res = await call().catch(async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return call();
    });
  } catch (error) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta_retry", error: (error as Error).name }));
    return;
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), job: "meta_retry", status: res.status }));
}

export const config: Config = { schedule: "@hourly" };
