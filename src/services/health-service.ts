import type { HealthCheckReport } from "@/domain/system/types";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getSystemHealthReport(): Promise<HealthCheckReport> {
  const envStatus = getPublicEnvStatus();
  const timestampUtc = new Date().toISOString();

  if (!envStatus.configured) {
    return {
      status: "degraded",
      service: "ujiankita-web",
      phase: "phase-6",
      timestampUtc,
      supabase: {
        configured: false,
        serviceRoleConfigured: envStatus.serviceRoleConfigured,
        reachable: false,
        error: "Variabel lingkungan Supabase belum dikonfigurasi.",
      },
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    // Lightweight public query to verify REST/PostgreSQL connectivity cleanly
    const { error } = await supabase.from("roles").select("code").limit(1);

    if (error && error.code !== "42501") {
      return {
        status: "degraded",
        service: "ujiankita-web",
        phase: "phase-6",
        timestampUtc,
        supabase: {
          configured: true,
          serviceRoleConfigured: envStatus.serviceRoleConfigured,
          reachable: false,
          error: "Database belum dapat diakses atau migrasi belum diterapkan.",
        },
      };
    }

    return {
      status: "healthy",
      service: "ujiankita-web",
      phase: "phase-6",
      timestampUtc,
      supabase: {
        configured: true,
        serviceRoleConfigured: envStatus.serviceRoleConfigured,
        reachable: true,
        error: null,
      },
    };
  } catch {
    return {
      status: "degraded",
      service: "ujiankita-web",
      phase: "phase-6",
      timestampUtc,
      supabase: {
        configured: true,
        serviceRoleConfigured: envStatus.serviceRoleConfigured,
        reachable: false,
        error: "Koneksi ke layanan Supabase gagal.",
      },
    };
  }
}
