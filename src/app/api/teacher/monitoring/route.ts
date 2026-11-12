import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { listTeacherMonitoredExamsService } from "@/services/monitoring-service";

export async function GET() {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const supabase = await createSupabaseServerClient();
    const exams = await listTeacherMonitoredExamsService(supabase, actor);
    return noStoreJson({ exams });
  } catch (error) {
    return handleApiError(error);
  }
}
