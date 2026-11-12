import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentSubmissionReceiptService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const receipt = await getStudentSubmissionReceiptService(supabase, actor, attemptId);
    return noStoreJson(receipt);
  } catch (error) {
    return handleApiError(error);
  }
}
