import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getExamAttemptsGradingListService } from "@/services/grading-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const data = await getExamAttemptsGradingListService(supabase, actor, id);
    return noStoreJson(data);
  } catch (error) {
    return handleApiError(error);
  }
}
