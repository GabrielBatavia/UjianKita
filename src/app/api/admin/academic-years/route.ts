import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAcademicYears } from "@/repositories/academic-repository";
import { createAcademicYearService } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET() {
  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const years = await fetchAcademicYears(supabase, actor.schoolId);
    return NextResponse.json({ academicYears: years });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "admin:academic-years:create", 20, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const result = await createAcademicYearService(
      supabase,
      actor,
      body,
      buildAuditContext(request)
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
