import {
  enforceActorRateLimit,
  handleApiError,
  noStoreJson,
  parseJsonBody,
} from "@/lib/api-helpers";
import { extractUserAgent } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { recordAttemptHeartbeatService } from "@/services/monitoring-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { attemptId } = await context.params;
    const limited = enforceActorRateLimit(
      `student:attempt:${attemptId}:heartbeat`,
      actor.userId,
      20,
      60_000
    );
    if (limited) return limited;

    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await recordAttemptHeartbeatService(
      supabase,
      actor,
      attemptId,
      body ?? {},
      extractUserAgent(request)
    );
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}
