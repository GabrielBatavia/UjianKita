import {
  buildAuditContext,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { ServiceError } from "@/services/errors";
import { grantBrowserOverrideService } from "@/services/monitoring-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.incidents.write");
    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();

    const { data: attemptRow } = await supabase
      .from("exam_attempts")
      .select("id, exam_id, student_id")
      .eq("id", attemptId)
      .maybeSingle();

    if (!attemptRow) {
      throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
    }

    const row = attemptRow as { id: string; exam_id: string; student_id: string };
    const body = await parseJsonBody(request);
    const result = await grantBrowserOverrideService(
      supabase,
      actor,
      {
        attemptId: row.id,
        examId: row.exam_id,
        studentId: row.student_id,
      },
      body,
      buildAuditContext(request)
    );
    return noStoreJson(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
