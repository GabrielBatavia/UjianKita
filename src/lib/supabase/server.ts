import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePublicSupabaseEnv } from "@/lib/env";

export async function createSupabaseServerClient() {
  const { url, anonKey } = requirePublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called inside a Server Component where setting cookies is a no-op;
          // proxy.ts refreshes session cookies on request boundaries.
        }
      },
    },
  });
}
