import { isDemoMode } from "@/lib/demo/mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORS_HEADERS, handleLeadIngest, type IngestResult } from "@/lib/ingest/handler";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) },
  });
}

export async function POST(request: Request) {
  if (isDemoMode()) {
    return Response.json(
      { error: { code: "DEMO_MODE", message: "API de ingestão desativada no modo demonstração." } },
      { status: 503 },
    );
  }
  const db = createAdminClient();

  return handleLeadIngest(request, {
    async findSecretKey(hash) {
      const { data, error } = await db
        .from("project_api_keys")
        .select("id, project_id, workspace_id")
        .eq("key_hash", hash)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async findLandingPage(publicKey) {
      const { data, error } = await db
        .from("landing_pages")
        .select("id, project_id, workspace_id, domains")
        .eq("public_key", publicKey)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async findForm(projectId, ref) {
      let query = db.from("forms").select("id").eq("project_id", projectId);
      query = UUID_RE.test(ref) ? query.eq("id", ref) : query.eq("key", ref);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    async ingest(payload) {
      const { data, error } = await db.rpc("ingest_lead_conversion", { p: payload });
      if (error) throw error;
      return data as IngestResult;
    },
    async markKeyUsed(keyId) {
      await db.from("project_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
    },
    log(entry) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), env: process.env.VERCEL_ENV ?? process.env.NODE_ENV, ...entry }));
    },
  });
}
