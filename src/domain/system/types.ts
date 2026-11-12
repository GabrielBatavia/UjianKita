export interface HealthCheckReport {
  status: "healthy" | "degraded";
  service: "ujiankita-web";
  phase: "phase-6";
  timestampUtc: string;
  supabase: {
    configured: boolean;
    serviceRoleConfigured: boolean;
    reachable: boolean;
    error: string | null;
  };
}
