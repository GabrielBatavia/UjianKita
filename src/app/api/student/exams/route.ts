import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listStudentAvailableExamsService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET() {
  try {
    const actor = await requireRoleActor("student");
    const supabase = await createSupabaseServerClient();
    const payload = await listStudentAvailableExamsService(supabase, actor);
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
