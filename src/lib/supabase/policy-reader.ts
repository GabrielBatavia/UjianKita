import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl, getPublicEnvStatus } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Returns a server-only privileged Supabase client for reading security policy
 * key hashes (which students are blocked from querying directly via RLS).
 * Falls back to the provided client in environments/tests where service-role
 * env vars are absent.
 */
export function getPolicyReaderClient(fallback: SupabaseClient): SupabaseClient {
  const status = getPublicEnvStatus();
  if (!status.configured || !status.serviceRoleConfigured) {
    return fallback;
  }
  return createSupabaseAdminClient();
}

export function resolveSafeRequestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${forwardedHost}`;
  }
  try {
    const parsed = new URL(request.url);
    if (parsed.origin && parsed.origin !== "null") {
      return parsed.origin;
    }
  } catch {
    // ignore invalid URL
  }
  return getAppUrl();
}
