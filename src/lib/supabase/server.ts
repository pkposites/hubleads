import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createDemoClient } from "@/lib/demo/client";
import { isDemoMode } from "@/lib/demo/mode";
import { cookieOpStore } from "@/lib/demo/store";
import { DB_SCHEMA, supabasePublishableKey, supabaseUrl } from "@/lib/env";

async function createSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting as the signed-in user (RLS applies). Create one per request. In demo
 * mode it is an in-memory stand-in over sample data.
 */
export async function createClient() {
  if (isDemoMode()) {
    return createDemoClient(cookieOpStore) as unknown as Awaited<ReturnType<typeof createSupabaseClient>>;
  }
  return createSupabaseClient();
}
