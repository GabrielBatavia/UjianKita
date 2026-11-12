import {
  buildAuditContext,
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { gradeAttemptEssaysService } from "@/services/grading-service";

export async function PUT(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const limited = enforceActorRateLimit("teacher:attempt:grade", actor.userId, 120, 60_000);
    if (limited) return limited;

    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await gradeAttemptEssaysService(
      supabase,
      actor,
      attemptId,
      body,
      buildAuditContext(request)
    );
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
