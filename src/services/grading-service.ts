import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type {
  TeacherAttemptDetailPayload,
  TeacherGradingAttemptSummary,
} from "@/domain/exams/phase3-types";
import { hasPermission, hasRole } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import { fetchExamDetail } from "@/repositories/exam-repository";
import {
  callAdjustGradeRpc,
  callCancelAttemptByAdminRpc,
  callGradeEssayRpc,
  callReleaseResultsRpc,
  fetchExamAttemptsForGrading,
  fetchTeacherAttemptDetail,
  fetchTeacherGradingOverview,
  type TeacherGradingExamSummaryItem,
} from "@/repositories/grading-repository";
import {
  adjustGradeSchema,
  cancelAttemptSchema,
  gradeEssayScoresSchema,
  releaseExamResultsSchema,
} from "@/schemas/attempts";
import type { RequestAuditContext } from "@/services/admin-service";
import { ServiceError } from "@/services/errors";
import { getAuthorizedSubjectIdsForActor } from "@/services/question-bank-service";

async function assertStaffExamGradeAccess(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  requiredPermission: "exams.grade" | "exams.results.release" | "exams.oversight"
) {
  if (!actor.isActive || !hasPermission(actor.roles, requiredPermission)) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin akses penilaian ujian.");
  }

  const detail = await fetchExamDetail(supabase, actor.schoolId, examId);
  if (!detail) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  }

  if (!hasRole(actor.roles, "admin")) {
    const subjects = await getAuthorizedSubjectIdsForActor(supabase, actor);
    if (!subjects.some((s) => s.id === detail.exam.subject_id)) {
      throw new ServiceError(
        403,
        "SUBJECT_FORBIDDEN",
        "Anda hanya dapat menilai ujian pada mata pelajaran yang ditugaskan kepada Anda."
      );
    }
  }

  return detail.exam;
}

function mapGradingRpcError(error: unknown, fallbackMessage: string): never {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : fallbackMessage;

  if (msg.includes("FORBIDDEN")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses operasi penilaian ditolak.");
  }
  if (msg.includes("ATTEMPT_NOT_FOUND")) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi peserta tidak ditemukan.");
  }
  if (msg.includes("ATTEMPT_NOT_FINALIZED")) {
    throw new ServiceError(
      409,
      "ATTEMPT_NOT_FINALIZED",
      "Sesi peserta belum selesai atau belum dikumpulkan."
    );
  }
  if (msg.includes("CANNOT_ADJUST_WHILE_ESSAY_PENDING")) {
    throw new ServiceError(
      409,
      "ESSAY_GRADING_INCOMPLETE",
      "Selesaikan penilaian semua soal esai terlebih dahulu sebelum melakukan penyesuaian nilai akhir."
    );
  }
  if (msg.includes("SCORE_OUT_OF_RANGE") || msg.includes("ADJUSTED_SCORE_OUT_OF_RANGE")) {
    throw new ServiceError(
      400,
      "SCORE_OUT_OF_RANGE",
      "Skor berada di luar rentang poin maksimal yang valid."
    );
  }
  if (msg.includes("REASON_REQUIRED")) {
    throw new ServiceError(
      400,
      "REASON_REQUIRED",
      "Alasan audit wajib diisi minimal 5 karakter."
    );
  }
  if (msg.includes("CANNOT_CANCEL_FINALIZED_ATTEMPT")) {
    throw new ServiceError(
      409,
      "ATTEMPT_ALREADY_FINALIZED",
      "Hanya sesi aktif yang dapat dibatalkan."
    );
  }

  throw new ServiceError(400, "GRADING_OPERATION_FAILED", fallbackMessage);
}

export async function getTeacherGradingOverviewService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<TeacherGradingExamSummaryItem[]> {
  if (!actor.isActive || !hasPermission(actor.roles, "exams.grade")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses ringkasan penilaian ditolak.");
  }

  if (hasRole(actor.roles, "admin")) {
    return fetchTeacherGradingOverview(supabase, actor.schoolId, null);
  }

  const subjects = await getAuthorizedSubjectIdsForActor(supabase, actor);
  return fetchTeacherGradingOverview(
    supabase,
    actor.schoolId,
    subjects.map((s) => s.id)
  );
}

export async function getExamAttemptsGradingListService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string
): Promise<{
  exam: Awaited<ReturnType<typeof assertStaffExamGradeAccess>>;
  attempts: TeacherGradingAttemptSummary[];
}> {
  const exam = await assertStaffExamGradeAccess(supabase, actor, examId, "exams.grade");
  const attempts = await fetchExamAttemptsForGrading(supabase, actor.schoolId, examId);
  return { exam, attempts };
}

export async function getTeacherAttemptDetailService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string
): Promise<TeacherAttemptDetailPayload> {
  if (!actor.isActive || !hasPermission(actor.roles, "exams.grade")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses detail penilaian ditolak.");
  }

  const detail = await fetchTeacherAttemptDetail(supabase, actor.schoolId, attemptId);
  if (!detail) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi peserta tidak ditemukan.");
  }

  await assertStaffExamGradeAccess(
    supabase,
    actor,
    detail.summary.examId,
    "exams.grade"
  );

  return detail;
}

export async function gradeAttemptEssaysService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
) {
  const detail = await getTeacherAttemptDetailService(supabase, actor, attemptId);

  const parsed = gradeEssayScoresSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data penilaian esai tidak valid."
    );
  }

  let updated: Awaited<ReturnType<typeof callGradeEssayRpc>>;
  try {
    updated = await callGradeEssayRpc(supabase, {
      attemptId,
      entries: parsed.data.entries.map((entry) => ({
        examVersionQuestionId: entry.examVersionQuestionId,
        assignedScore: entry.assignedScore,
        feedback: entry.feedback ?? null,
      })),
      releaseIfComplete: parsed.data.releaseIfComplete,
    });
  } catch (error) {
    mapGradingRpcError(error, "Gagal menyimpan penilaian esai.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: updated.pendingManualCount === 0 ? "grading.finalized" : "grading.essay_saved",
    entityType: "exam_attempt",
    entityId: attemptId,
    summary: `Menilai soal esai untuk ${detail.summary.studentName} (${detail.examTitle})`,
    metadata: {
      examId: detail.summary.examId,
      gradingStatus: updated.gradingStatus,
      totalScore: updated.totalScore,
      pendingManualCount: updated.pendingManualCount,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return updated;
}

export async function adjustAttemptGradeService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
) {
  const detail = await getTeacherAttemptDetailService(supabase, actor, attemptId);

  const parsed = adjustGradeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data penyesuaian nilai tidak valid."
    );
  }

  let result: Awaited<ReturnType<typeof callAdjustGradeRpc>>;
  try {
    result = await callAdjustGradeRpc(supabase, {
      attemptId,
      newTotalScore: parsed.data.newTotalScore,
      reason: parsed.data.reason,
    });
  } catch (error) {
    mapGradingRpcError(error, "Gagal melakukan penyesuaian nilai.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "grading.adjusted",
    entityType: "exam_attempt",
    entityId: attemptId,
    summary: `Penyesuaian nilai ${detail.summary.studentName} (${result.previousTotalScore} -> ${result.totalScore})`,
    metadata: {
      examId: detail.summary.examId,
      reason: parsed.data.reason,
      previousTotalScore: result.previousTotalScore,
      newTotalScore: result.totalScore,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return result;
}

export async function releaseExamResultsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
) {
  const exam = await assertStaffExamGradeAccess(
    supabase,
    actor,
    examId,
    "exams.results.release"
  );

  const parsed = releaseExamResultsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Permintaan rilis nilai tidak valid."
    );
  }

  let result: Awaited<ReturnType<typeof callReleaseResultsRpc>>;
  try {
    result = await callReleaseResultsRpc(supabase, {
      examId,
      action: parsed.data.action,
      allowStudentReview: parsed.data.allowStudentReview,
    });
  } catch (error) {
    mapGradingRpcError(error, "Gagal mengubah status publikasi hasil ujian.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: parsed.data.action === "release" ? "results.released" : "results.unpublished",
    entityType: "exam",
    entityId: examId,
    summary:
      parsed.data.action === "release"
        ? `Merilis hasil ujian "${exam.title}" ke siswa`
        : `Menarik publikasi hasil ujian "${exam.title}"`,
    metadata: {
      releasedCount: result.releasedCount ?? 0,
      pendingManualCount: result.pendingManualCount ?? 0,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return result;
}

export async function cancelAttemptByAdminService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
) {
  if (!actor.isActive || !hasRole(actor.roles, "admin") || !hasPermission(actor.roles, "exams.oversight")) {
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Pembatalan sesi ujian hanya diizinkan untuk administrator sekolah."
    );
  }

  const detail = await fetchTeacherAttemptDetail(supabase, actor.schoolId, attemptId);
  if (!detail) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
  }

  const parsed = cancelAttemptSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Alasan pembatalan wajib diisi."
    );
  }

  let result: Awaited<ReturnType<typeof callCancelAttemptByAdminRpc>>;
  try {
    result = await callCancelAttemptByAdminRpc(supabase, {
      attemptId,
      reason: parsed.data.reason,
    });
  } catch (error) {
    mapGradingRpcError(error, "Gagal membatalkan sesi ujian.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "attempt.cancelled",
    entityType: "exam_attempt",
    entityId: attemptId,
    summary: `Admin membatalkan sesi ujian ${detail.summary.studentName} (${detail.examTitle})`,
    metadata: {
      examId: detail.summary.examId,
      reason: parsed.data.reason,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return result;
}
