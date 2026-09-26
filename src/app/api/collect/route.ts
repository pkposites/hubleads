import { COLLECT_CORS, handleCollect, handleConfig, type CollectDeps } from "@/lib/collect";
import { after } from "next/server";
import { call } from "@/lib/db";
import { notifyNewLead } from "@/lib/push";

const deps: CollectDeps = {
  collect: (key, originHost, event) =>
    call("lh_collect", { p_key: key, p_origin_host: originHost, p_event: event }),
  pageConfig: (key) => call("lh_page_config", { p_key: key }),
  countVisit: (key, originHost, client, dims) =>
    call("lh_count_visit", { p_key: key, p_origin_host: originHost, p_client: client, p_dims: dims }),
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
