import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so every caller must scope its queries
 * to a workspace/project it has already authorised (blueprint §14.2).
 */
export function createAdminClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
