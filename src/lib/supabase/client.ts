import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const { url, anonKey } = requirePublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
