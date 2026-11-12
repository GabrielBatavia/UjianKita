import {
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toggleStudentFlagService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:attempt:${attemptId}:flag`,
      actor.userId,
      180,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await toggleStudentFlagService(supabase, actor, attemptId, body);
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
