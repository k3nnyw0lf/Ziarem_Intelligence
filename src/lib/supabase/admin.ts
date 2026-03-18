/**
 * Server-only Supabase client with service role for webhooks and backend.
 * Use for API routes that must bypass RLS (e.g. call-end webhook).
 * Lazy so build can succeed without env vars.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient(url, key);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) _admin = createAdminClient();
  return _admin;
}

/** @deprecated Use getSupabaseAdmin() so build does not require env. Kept for compatibility; lazy. */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseAdmin() as unknown as Record<string, unknown>)[prop as string];
  },
});
