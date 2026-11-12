import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { listExamIncidentsService } from "@/services/monitoring-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const incidents = await listExamIncidentsService(supabase, actor, examId);
    return noStoreJson({ incidents });
  } catch (error) {
    return handleApiError(error);
  }
}
