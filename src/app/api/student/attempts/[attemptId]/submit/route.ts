import {
  buildAuditContext,
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { submitStudentAttemptService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:attempt:${attemptId}:submit`,
      actor.userId,
      20,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const receipt = await submitStudentAttemptService(
      supabase,
      actor,
      attemptId,
      body,
      buildAuditContext(request)
    );
    return noStoreJson(receipt);
  } catch (error) {
    return handleApiError(error);
  }
}
