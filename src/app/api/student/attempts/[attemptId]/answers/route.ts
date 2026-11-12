import {
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveStudentAnswerService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function PUT(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:attempt:${attemptId}:save`,
      actor.userId,
      180,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const ack = await saveStudentAnswerService(supabase, actor, attemptId, body);

    const status =
      ack.outcome === "COMMITTED" || ack.outcome === "IDEMPOTENT_REPLAY"
        ? 200
        : ack.outcome === "DEADLINE_EXPIRED"
          ? 410
          : ack.outcome === "ATTEMPT_CANCELLED"
            ? 403
            : 409;

    return noStoreJson(ack, status);
  } catch (error) {
    return handleApiError(error);
  }
}
