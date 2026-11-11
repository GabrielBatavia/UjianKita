import { NextResponse } from "next/server";
import { buildAuditContext, enforceApiRateLimit, handleApiError } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { duplicateQuestionService } from "@/services/question-bank-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:questions:duplicate", 40, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const result = await duplicateQuestionService(supabase, actor, id, buildAuditContext(request));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
