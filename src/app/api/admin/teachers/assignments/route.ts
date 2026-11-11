import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignTeacherService } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "admin:teachers:assign", 40, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    await assignTeacherService(supabase, actor, body, buildAuditContext(request));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
