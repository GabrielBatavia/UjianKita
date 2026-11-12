import {
  buildAuditContext,
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { cancelAttemptByAdminService } from "@/services/grading-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("admin");
    const limited = enforceActorRateLimit("admin:attempt:cancel", actor.userId, 30, 60_000);
    if (limited) return limited;

    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await cancelAttemptByAdminService(
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
