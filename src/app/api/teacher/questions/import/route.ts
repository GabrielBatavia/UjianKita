import { NextResponse } from "next/server";
import { MAX_IMPORT_FILE_BYTES } from "@/domain/exams/import-parser";
import { enforceApiRateLimit, handleApiError } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { ServiceError } from "@/services/errors";
import { commitQuestionImportService } from "@/services/question-bank-service";

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "teacher:questions:import-commit", 15, 60_000);
  if (rateBlocked) return rateBlocked;

  try {
    const actor = await requireAnyRoleActor(["teacher", "admin"]);
    const formData = await request.formData();
    const subjectId = formData.get("subjectId");
    const file = formData.get("file");
    const allowSkipRejected = formData.get("allowSkipRejected") === "true";

    if (typeof subjectId !== "string" || !subjectId) {
      throw new ServiceError(400, "VALIDATION_ERROR", "Mata pelajaran wajib dipilih.");
    }
    if (!(file instanceof File)) {
      throw new ServiceError(400, "VALIDATION_ERROR", "Berkas CSV atau XLSX wajib diunggah.");
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new ServiceError(400, "FILE_TOO_LARGE", "Ukuran berkas melebihi batas 2 MB.");
    }

    const buffer = await file.arrayBuffer();
    const supabase = await createSupabaseServerClient();
    const result = await commitQuestionImportService(supabase, actor, {
      subjectId,
      fileName: file.name,
      buffer,
      allowSkipRejected,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
