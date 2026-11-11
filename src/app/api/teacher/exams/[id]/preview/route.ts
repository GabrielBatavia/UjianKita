import { NextResponse, type NextRequest } from "next/server";
import { handleApiError } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getExamPreviewService } from "@/services/exam-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const sp = request.nextUrl.searchParams;
    const mode = sp.get("mode") === "teacher" ? "teacher" : "student";
    const preferPublished = sp.get("source") === "published";

    const supabase = await createSupabaseServerClient();
    const payload = await getExamPreviewService(supabase, actor, id, mode, preferPublished);
    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
