import { NextResponse } from "next/server";
import {
  buildAuditContext,
  enforceApiRateLimit,
  handleApiError,
  parseJsonBody,
} from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { ServiceError } from "@/services/errors";
import { validateExamForReviewService } from "@/services/exam-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:exams:validate", 30, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const body = await parseJsonBody(request);
    const versionLock =
      body && typeof body === "object" && "versionLock" in body
        ? Number((body as { versionLock: unknown }).versionLock)
        : NaN;

    if (!Number.isInteger(versionLock) || versionLock < 1) {
      throw new ServiceError(400, "VALIDATION_ERROR", "versionLock wajib disertakan.");
    }

    const result = await validateExamForReviewService(
      supabase,
      actor,
      id,
      versionLock,
      buildAuditContext(request)
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
