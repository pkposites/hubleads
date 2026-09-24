import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

export class DbError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Without generated database types supabase-js cannot type RPC arguments, so
// the client is narrowed to the one method this app uses.
interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

let client: RpcClient | undefined;

function db(): RpcClient {
  client ??= createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as RpcClient;
  return client;
}

/** Calls one of the lh_* database functions. Throws DbError with the SQLSTATE. */
export async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new DbError(error.code ?? "unknown", error.message);
  return data as T;
}
