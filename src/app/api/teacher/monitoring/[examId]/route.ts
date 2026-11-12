import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { getTeacherExamControlCenterService } from "@/services/monitoring-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const { examId } = await context.params;
    const url = new URL(request.url);
    const supabase = await createSupabaseServerClient();

    const payload = await getTeacherExamControlCenterService(supabase, actor, examId, {
      search: url.searchParams.get("search") ?? undefined,
      presence: url.searchParams.get("presence") ?? undefined,
      severity: url.searchParams.get("severity") ?? undefined,
      attemptStatus: url.searchParams.get("attemptStatus") ?? undefined,
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? 50),
    });

    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
