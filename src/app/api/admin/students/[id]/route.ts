import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateStudentService } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "admin:students:update", 40, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    await updateStudentService(supabase, actor, id, body, buildAuditContext(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
