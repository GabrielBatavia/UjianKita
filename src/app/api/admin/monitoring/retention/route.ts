import {
  buildAuditContext,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { runMonitoringRetentionPurgeService } from "@/services/monitoring-service";

export async function POST(request: Request) {
  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await runMonitoringRetentionPurgeService(
      supabase,
      actor,
      body,
      buildAuditContext(request)
    );
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
