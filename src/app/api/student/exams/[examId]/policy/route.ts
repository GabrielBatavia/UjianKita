import { handleApiError, noStoreJson } from "@/lib/api-helpers";
import {
  getPolicyReaderClient,
  resolveSafeRequestOrigin,
} from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getStudentSecurityPolicyViewService } from "@/services/monitoring-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const payload = await getStudentSecurityPolicyViewService(
      supabase,
      getPolicyReaderClient(supabase),
      actor,
      examId,
      resolveSafeRequestOrigin(request)
    );
    return noStoreJson(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
