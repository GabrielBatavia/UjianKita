import { createClient } from "@supabase/supabase-js";
import { requireServiceRoleEnv } from "@/lib/env";

/**
 * Server-only privileged Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Must NEVER be imported from client components or browser code.
 */
export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = requireServiceRoleEnv();
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
