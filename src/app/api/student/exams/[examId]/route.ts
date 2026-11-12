import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentExamOverviewService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const item = await getStudentExamOverviewService(supabase, actor, examId);
    return noStoreJson(item);
  } catch (error) {
    return handleApiError(error);
  }
}
