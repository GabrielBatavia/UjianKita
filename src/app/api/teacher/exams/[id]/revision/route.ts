import { NextResponse } from "next/server";
import { enforceApiRateLimit, handleApiError, parseJsonBody } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { startExamRevisionService } from "@/services/exam-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:exams:revision", 15, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await startExamRevisionService(supabase, actor, id, body);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
