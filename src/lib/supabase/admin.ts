import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";
import { isDemoMode } from "@/lib/demo/mode";
import { cookieOpStore } from "@/lib/demo/store";
import { DB_SCHEMA, supabaseSecretKey, supabaseUrl } from "@/lib/env";

function createServiceClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Service-role client. Bypasses RLS, so every caller must scope its queries
 * to a workspace/project it has already authorised (blueprint §14.2).
 */
export function createAdminClient() {
  if (isDemoMode()) return createDemoClient(cookieOpStore) as unknown as ReturnType<typeof createServiceClient>;
  return createServiceClient();
}
