import { createHmac } from "node:crypto";
import { clientIp } from "@/lib/collect";
import { call } from "@/lib/db";
import { basicAuth, googleAdsCsv, type GoogleAdsRow } from "@/lib/google-ads";
import { serverSecret } from "@/lib/server";

/**
 * GET /api/google-ads/<feed id>: the conversions file Google Ads fetches on a
 * schedule, protected by user and password (HTTP Basic). Logs carry only
 * counts, never click ids.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), route: "GET /api/google-ads", ...entry }));
const denied = () =>
  new Response("Usuário ou senha incorretos.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Lead Hub", charset="UTF-8"', "Cache-Control": "no-store" },
  });

export async function GET(request: Request, ctx: RouteContext<"/api/google-ads/[feed]">) {
  const secret = serverSecret();
  if (!secret) return new Response("Servidor sem configuração.", { status: 503 });
  const feed = (await ctx.params).feed.replace(/\.csv$/i, "");
  const auth = basicAuth(request.headers.get("authorization"));
  if (!UUID.test(feed) || !auth) return denied();

  const ip = clientIp(request);
  const client = ip ? createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32) : "";
  const result = await call<{ rows?: GoogleAdsRow[]; limited?: boolean } | null>("lh_server_google_ads_feed", {
    p_secret: secret,
    p_client: client,
    p_feed_id: feed,
    p_username: auth.username,
    p_password: auth.password,
  });
  if (result?.limited) return new Response("Muitas requisições.", { status: 429 });
  if (!result?.rows) {
    log({ ok: false });
    return denied();
  }
  log({ ok: true, rows: result.rows.length });
  return new Response(googleAdsCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="conversoes-google-ads.csv"',
      "Cache-Control": "no-store",
    },
  });
}
