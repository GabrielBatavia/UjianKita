import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSubjectService, getSubjectsPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET() {
  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const data = await getSubjectsPageData(supabase, actor);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "admin:subjects:create", 30, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await createSubjectService(supabase, actor, body, buildAuditContext(request));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
