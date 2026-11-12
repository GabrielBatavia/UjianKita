import {
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { getPolicyReaderClient } from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordStudentTelemetryEventService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { recordMonitoringEventsBatchService } from "@/services/monitoring-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:attempt:${attemptId}:events`,
      actor.userId,
      120,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const policyReader = getPolicyReaderClient(supabase);
    const body = await parseJsonBody(request);

    if (
      body &&
      typeof body === "object" &&
      "events" in body &&
      Array.isArray((body as { events: unknown }).events)
    ) {
      const batchResult = await recordMonitoringEventsBatchService(
        supabase,
        policyReader,
        actor,
        attemptId,
        body
      );
      return noStoreJson(batchResult, 201);
    }

    const result = await recordStudentTelemetryEventService(
      supabase,
      actor,
      attemptId,
      body,
      policyReader
    );
    return noStoreJson(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
