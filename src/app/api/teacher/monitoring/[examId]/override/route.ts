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
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.incidents.write");
    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const raw = (await parseJsonBody(request)) as Record<string, unknown> | null;
    const studentId = raw?.studentId ? String(raw.studentId) : undefined;
    const attemptId = raw?.attemptId ? String(raw.attemptId) : undefined;

    if (!studentId && !attemptId) {
      throw new ServiceError(
        400,
        "MISSING_TARGET",
        "studentId atau attemptId wajib disediakan."
      );
    }

    const result = await grantBrowserOverrideService(
      supabase,
      actor,
      { examId, studentId, attemptId },
      raw,
      buildAuditContext(request)
    );
    return noStoreJson(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
