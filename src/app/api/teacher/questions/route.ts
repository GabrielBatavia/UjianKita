import { NextResponse, type NextRequest } from "next/server";
import type {
  QuestionDifficulty,
  QuestionStatus,
  QuestionType,
} from "@/domain/exams/phase2-types";
import { enforceApiRateLimit, handleApiError, parseJsonBody } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import {
  createQuestionService,
  listQuestionsService,
} from "@/services/question-bank-service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const sp = request.nextUrl.searchParams;
    const supabase = await createSupabaseServerClient();

    const data = await listQuestionsService(supabase, actor, {
      subjectId: sp.get("subjectId") || undefined,
      questionType: (sp.get("questionType") as QuestionType | null) || undefined,
      difficulty: (sp.get("difficulty") as QuestionDifficulty | null) || undefined,
      status: (sp.get("status") as QuestionStatus | "all_non_archived" | null) || undefined,
      search: sp.get("search") || undefined,
      tag: sp.get("tag") || undefined,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 20,
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:questions:create", 60, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await createQuestionService(supabase, actor, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
