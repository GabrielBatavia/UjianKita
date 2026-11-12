import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getTeacherAttemptDetailService } from "@/services/grading-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const detail = await getTeacherAttemptDetailService(supabase, actor, attemptId);
    return noStoreJson(detail);
  } catch (error) {
    return handleApiError(error);
  }
}
