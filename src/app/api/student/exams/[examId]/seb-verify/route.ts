import {
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
import { requireRoleActor } from "@/services/auth-service";
import { verifyStudentSebProofService } from "@/services/monitoring-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { examId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:exam:${examId}:seb-verify`,
      actor.userId,
      30,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const outcome = await verifyStudentSebProofService(
      supabase,
      getPolicyReaderClient(supabase),
      actor,
      examId,
      resolveSafeRequestOrigin(request),
      request.headers,
      body
    );
    return noStoreJson(outcome, outcome.verified ? 200 : 403);
  } catch (error) {
    return handleApiError(error);
  }
}
