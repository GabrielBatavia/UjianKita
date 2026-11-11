import { NextResponse, type NextRequest } from "next/server";
import type { ExamStatus } from "@/domain/exams/phase2-types";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { createExamService, listExamsService } from "@/services/exam-service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const sp = request.nextUrl.searchParams;
    const supabase = await createSupabaseServerClient();

    const data = await listExamsService(supabase, actor, {
      subjectId: sp.get("subjectId") || undefined,
      status: (sp.get("status") as ExamStatus | null) || undefined,
      classId: sp.get("classId") || undefined,
      search: sp.get("search") || undefined,
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : 20,
    });

    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:exams:create", 30, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await createExamService(supabase, actor, body, buildAuditContext(request));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
