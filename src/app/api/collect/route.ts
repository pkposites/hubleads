import { createHmac } from "node:crypto";
import { COLLECT_CORS, handleCollect, handleConfig, type CollectDeps } from "@/lib/collect";
import { after } from "next/server";
import { call } from "@/lib/db";
import { notifyNewLead } from "@/lib/push";
import { serverSecret } from "@/lib/server";

// Events go through lh_server_* functions, which only this server can call
// (server secret) and which apply the sending limits per device.
const secret = () => {
  const value = serverSecret();
  if (!value) console.error(JSON.stringify({ route: "POST /api/collect", error: "LH_SERVER_SECRET is not set" }));
  return value;
};

const deps: CollectDeps = {
  collect: (key, originHost, event, client) =>
    call("lh_server_collect", { p_secret: secret(), p_client: client, p_key: key, p_origin_host: originHost, p_event: event }),
  countVisit: (key, originHost, visitor, dims, client) =>
    call("lh_server_count_visit", {
      p_secret: secret(),
      p_client: client,
      p_key: key,
      p_origin_host: originHost,
      p_visitor: visitor,
      p_dims: dims,
    }),
  clientKey: (ip) => (ip ? createHmac("sha256", serverSecret() ?? "lead-hub-collect").update(ip).digest("hex").slice(0, 32) : ""),
  pageConfig: (key) => call("lh_page_config", { p_key: key }),
  log: (entry) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry })),
  onNewLead: (leadId) => after(() => notifyNewLead(leadId)),
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: COLLECT_CORS });
}

export function GET(request: Request) {
  return handleConfig(request, deps);
}

export function POST(request: Request) {
  return handleCollect(request, deps);
}
