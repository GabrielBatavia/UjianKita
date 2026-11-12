import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getTeacherGradingOverviewService } from "@/services/grading-service";

export async function GET() {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const supabase = await createSupabaseServerClient();
    const exams = await getTeacherGradingOverviewService(supabase, actor);
    return noStoreJson({ exams });
  } catch (error) {
    return handleApiError(error);
  }
}
