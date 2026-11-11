import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSettingsPageData, updateSchoolSettingsService } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";

export async function GET() {
  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const data = await getSettingsPageData(supabase, actor);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "admin:settings:update", 20, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireRoleActor("admin");
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    await updateSchoolSettingsService(supabase, actor, body, buildAuditContext(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
