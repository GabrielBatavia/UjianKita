import {
  buildAuditContext,
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { releaseExamResultsService } from "@/services/grading-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const limited = enforceActorRateLimit("teacher:exam:release", actor.userId, 30, 60_000);
    if (limited) return limited;

    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await releaseExamResultsService(
      supabase,
      actor,
      id,
      body,
      buildAuditContext(request)
    );
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
