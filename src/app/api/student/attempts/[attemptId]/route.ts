import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentAttemptWorkspaceService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const payload = await getStudentAttemptWorkspaceService(supabase, actor, attemptId);
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
