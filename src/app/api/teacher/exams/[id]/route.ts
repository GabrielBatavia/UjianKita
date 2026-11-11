import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getExamDetailService, updateExamService } from "@/services/exam-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const detail = await getExamDetailService(supabase, actor, id);
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:exams:update", 40, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await updateExamService(supabase, actor, id, body, buildAuditContext(request));
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
