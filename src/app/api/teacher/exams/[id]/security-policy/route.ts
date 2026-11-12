import {
  buildAuditContext,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { resolveSafeRequestOrigin } from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import {
  getExamSecurityPolicyService,
  updateExamSecurityPolicyService,
} from "@/services/monitoring-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const policy = await getExamSecurityPolicyService(supabase, actor, id);
    return noStoreJson({ policy });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.policies.write");
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const policy = await updateExamSecurityPolicyService(
      supabase,
      actor,
      id,
      body,
      resolveSafeRequestOrigin(request),
      buildAuditContext(request)
    );
    return noStoreJson({ policy });
  } catch (error) {
    return handleApiError(error);
  }
}
