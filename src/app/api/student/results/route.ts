import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listStudentResultsService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET() {
  try {
    const actor = await requireRoleActor("student");
    const supabase = await createSupabaseServerClient();
    const results = await listStudentResultsService(supabase, actor);
    return noStoreJson({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
