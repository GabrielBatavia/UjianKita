import { NextResponse } from "next/server";
import { enforceApiRateLimit, handleApiError, parseJsonBody } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import {
  getQuestionDetailService,
  updateQuestionService,
} from "@/services/question-bank-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const detail = await getQuestionDetailService(supabase, actor, id);
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:questions:update", 60, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await updateQuestionService(supabase, actor, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
