import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import {
  getPolicyReaderClient,
  resolveSafeRequestOrigin,
} from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentAttemptWorkspaceService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const payload = await getStudentAttemptWorkspaceService(supabase, actor, attemptId, {
      policyReaderSupabase: getPolicyReaderClient(supabase),
      origin: resolveSafeRequestOrigin(request),
      headers: request.headers,
    });
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
