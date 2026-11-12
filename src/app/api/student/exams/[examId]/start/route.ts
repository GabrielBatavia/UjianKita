import {
  buildAuditContext,
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import {
  getPolicyReaderClient,
  resolveSafeRequestOrigin,
} from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startOrResumeStudentAttemptService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const limited = enforceActorRateLimit("student:attempt:start", actor.userId, 20, 60_000);
    if (limited) return limited;

    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await startOrResumeStudentAttemptService(
      supabase,
      actor,
      examId,
      body,
      buildAuditContext(request),
      {
        policyReaderSupabase: getPolicyReaderClient(supabase),
        origin: resolveSafeRequestOrigin(request),
        headers: request.headers,
      }
    );
    return noStoreJson(result, result.created ? 201 : 200);
  } catch (error) {
    return handleApiError(error);
  }
}
