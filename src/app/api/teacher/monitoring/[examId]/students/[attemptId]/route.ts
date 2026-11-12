import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { getStudentMonitoringTimelineService } from "@/services/monitoring-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examId: string; attemptId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const { examId, attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const payload = await getStudentMonitoringTimelineService(
      supabase,
      actor,
      examId,
      attemptId
    );
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
