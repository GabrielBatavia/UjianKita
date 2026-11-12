import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { getAdminMonitoringOverviewService } from "@/services/monitoring-service";

export async function GET() {
  try {
    const actor = await requirePermissionActor("monitoring.oversight");
    const supabase = await createSupabaseServerClient();
    const payload = await getAdminMonitoringOverviewService(supabase, actor);
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
