import {
  buildAuditContext,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import {
  getIncidentDetailService,
  transitionIncidentStatusService,
} from "@/services/monitoring-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ incidentId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.read");
    const { incidentId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const detail = await getIncidentDetailService(supabase, actor, incidentId);
    return noStoreJson(detail);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ incidentId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.incidents.write");
    const { incidentId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await transitionIncidentStatusService(
      supabase,
      actor,
      incidentId,
      body,
      buildAuditContext(request)
    );
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
