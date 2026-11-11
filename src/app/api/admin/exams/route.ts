import { NextResponse, type NextRequest } from "next/server";
import type { ExamStatus } from "@/domain/exams/phase2-types";
import { handleApiError } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { listExamsService } from "@/services/exam-service";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRoleActor("admin");
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
