import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { removeTeacherAssignmentService } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "admin:teachers:unassign", 40, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    await removeTeacherAssignmentService(supabase, actor, id, buildAuditContext(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
