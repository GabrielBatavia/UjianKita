import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type { AuthoritativeAnswerAck, SubmissionReceipt } from "@/domain/exams/contracts";
import { canStudentViewExamResults, classifyStudentExamEligibility } from "@/domain/exams/eligibility";
import type {
  AttemptTimeSyncPayload,
  StudentAttemptWorkspacePayload,
  StudentExamAvailabilityItem,
  StudentResponsePayload,
  StudentResultListItem,
  StudentSubmissionReceiptDetail,
} from "@/domain/exams/phase3-types";
import { hasPermission } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import {
  callSaveAnswerRpc,
  callStartOrResumeAttemptRpc,
  callSubmitAttemptRpc,
  callToggleFlagRpc,
  fetchAttemptTimeSync,
  fetchAttemptWorkspaceData,
  fetchStudentAssignedExams,
  fetchStudentResultsData,
  fetchSubmissionReceiptDetail,
  getActiveStudentContext,
  insertClientTelemetryEvent,
} from "@/repositories/attempt-repository";
import {
  clientTelemetryEventSchema,
  saveAnswerSchema,
  startAttemptSchema,
  submitAttemptSchema,
  toggleFlagSchema,
} from "@/schemas/attempts";
import type { RequestAuditContext } from "@/services/admin-service";
import { ServiceError } from "@/services/errors";
import { normalizeLegacyTelemetryEventType } from "@/domain/monitoring/phase4-types";
import { startAttemptSecurityContextSchema } from "@/schemas/monitoring";
import {
  enforceBrowserPolicyOnExamAccess,
  recordMonitoringEventsBatchService,
} from "@/services/monitoring-service";

export function computeAnswerPayloadHash(
  attemptQuestionId: string,
  payload: StudentResponsePayload
): string {
  const canonical =
    payload.questionType === "multiple_choice"
      ? {
          attemptQuestionId,
          questionType: payload.questionType,
          selectedOptionKeys: [...payload.selectedOptionKeys].sort(),
        }
      : payload.questionType === "essay"
        ? {
            attemptQuestionId,
            questionType: payload.questionType,
            textAnswer: payload.textAnswer,
          }
        : {
            attemptQuestionId,
            questionType: payload.questionType,
            selectedOptionKey: payload.selectedOptionKey,
          };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function mapRpcError(error: unknown, fallbackMessage: string): never {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : fallbackMessage;

  if (msg.includes("EXAM_WINDOW_NOT_OPEN")) {
    throw new ServiceError(403, "EXAM_WINDOW_NOT_OPEN", "Jendela pelaksanaan ujian belum dibuka.");
  }
  if (msg.includes("EXAM_WINDOW_CLOSED")) {
    throw new ServiceError(403, "EXAM_WINDOW_CLOSED", "Jendela pelaksanaan ujian telah berakhir.");
  }
  if (msg.includes("LATE_JOIN_CUTOFF_PASSED")) {
    throw new ServiceError(
      403,
      "LATE_JOIN_CUTOFF_PASSED",
      "Batas waktu keterlambatan masuk ujian telah terlewati."
    );
  }
  if (msg.includes("ATTEMPT_LIMIT_REACHED")) {
    throw new ServiceError(
      409,
      "ATTEMPT_LIMIT_REACHED",
      "Anda telah menggunakan seluruh batas kesempatan ujian."
    );
  }
  if (msg.includes("EXAM_NOT_PUBLISHED")) {
    throw new ServiceError(403, "EXAM_NOT_PUBLISHED", "Ujian belum berstatus terbit.");
  }
  if (msg.includes("NO_CLASS_ASSIGNMENT")) {
    throw new ServiceError(
      403,
      "NO_CLASS_ASSIGNMENT",
      "Kelas Anda belum dijadwalkan untuk mengikuti ujian ini."
    );
  }
  if (msg.includes("ATTEMPT_CANCELLED")) {
    throw new ServiceError(
      403,
      "ATTEMPT_CANCELLED",
      "Sesi ujian telah dibatalkan oleh administrator."
    );
  }
  if (msg.includes("ATTEMPT_NOT_FOUND") || msg.includes("UNAUTHORIZED_STUDENT")) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
  }
  if (msg.includes("DEADLINE_EXPIRED") || msg.includes("ATTEMPT_ALREADY_FINALIZED")) {
    throw new ServiceError(
      410,
      "DEADLINE_EXPIRED",
      "Batas waktu sesi ujian telah berakhir."
    );
  }
  if (msg.includes("INVALID_OPTION_KEY") || msg.includes("QUESTION_TYPE_MISMATCH")) {
    throw new ServiceError(
      400,
      "INVALID_ANSWER_PAYLOAD",
      "Format jawaban atau pilihan opsi tidak sesuai dengan soal ujian."
    );
  }

  throw new ServiceError(400, "EXAM_ENGINE_ERROR", fallbackMessage);
}

async function requireActiveStudentContext(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  permission: "student.exams.read" | "student.attempts.write" | "student.results.read"
) {
  if (!actor.isActive || !hasPermission(actor.roles, permission)) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const context = await getActiveStudentContext(supabase, actor.userId, actor.schoolId);
  if (!context) {
    throw new ServiceError(
      403,
      "STUDENT_NOT_ENROLLED",
      "Akun siswa belum terdaftar aktif pada kelas di sekolah ini."
    );
  }
  return context;
}

export async function listStudentAvailableExamsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  nowUtcMs = Date.now()
): Promise<{
  className: string;
  studentNis: string | null;
  serverNowUtc: string;
  items: StudentExamAvailabilityItem[];
}> {
  const context = await requireActiveStudentContext(supabase, actor, "student.exams.read");
  const rows = await fetchStudentAssignedExams(supabase, context);

  const items: StudentExamAvailabilityItem[] = rows.map((row) => {
    const eligibility = classifyStudentExamEligibility({
      examStatus: row.examStatus,
      publishedVersionId: row.publishedVersionId,
      hasClassSchedule: true,
      startsAtUtc: row.startsAt,
      endsAtUtc: row.endsAt,
      durationMinutes: row.durationMinutes,
      maxAttempts: row.maxAttempts,
      lateJoinMinutes: row.lateJoinMinutes,
      nowUtcMs,
      attempts: row.attempts.map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        deadlineAtUtc: a.deadlineAtUtc,
        submittedAtUtc: a.submittedAtUtc,
      })),
    });

    const latestAttempt = row.attempts[0] ?? null;
    const resultCheck = latestAttempt
      ? canStudentViewExamResults({
          attemptStatus: latestAttempt.status,
          gradingStatus: latestAttempt.gradingStatus,
          releaseStatus: latestAttempt.releaseStatus ?? "UNRELEASED",
          releasePolicy: row.resultReleasePolicy,
          scheduleEndsAtUtc: row.endsAt,
          nowUtcMs,
        })
      : { visible: false, reason: null };

    return {
      examId: row.examId,
      title: row.title,
      description: row.description,
      instructions: row.instructions,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      subjectCode: row.subjectCode,
      classId: row.classId,
      className: row.className,
      examStatus: row.examStatus,
      publishedVersionId: row.publishedVersionId,
      durationMinutes: row.durationMinutes,
      maxAttempts: row.maxAttempts,
      passingScore: row.passingScore,
      lateJoinMinutes: row.lateJoinMinutes,
      requireExamBrowser: row.requireExamBrowser,
      randomizeQuestions: row.randomizeQuestions,
      randomizeOptions: row.randomizeOptions,
      resultReleasePolicy: row.resultReleasePolicy,
      resultsReleasedAt: row.resultsReleasedAt,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      questionCount: row.questionCount,
      totalPoints: row.totalPoints,
      category: eligibility.category,
      reasonCode: eligibility.reasonCode,
      statusMessage: eligibility.statusMessage,
      canStart: eligibility.canStart,
      canResume: eligibility.canResume,
      attemptsUsed: eligibility.attemptsUsed,
      activeAttemptId: eligibility.activeAttemptId,
      latestAttemptId: latestAttempt?.id ?? null,
      latestAttemptStatus: latestAttempt?.status ?? null,
      latestReceiptCode: latestAttempt?.receiptCode ?? null,
      canViewReceipt: eligibility.canViewReceipt,
      canViewResult: resultCheck.visible,
    };
  });

  return {
    className: context.className,
    studentNis: context.nis,
    serverNowUtc: new Date(nowUtcMs).toISOString(),
    items,
  };
}

export async function getStudentExamOverviewService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  nowUtcMs = Date.now()
): Promise<StudentExamAvailabilityItem> {
  const { items } = await listStudentAvailableExamsService(supabase, actor, nowUtcMs);
  const match = items.find((item) => item.examId === examId);
  if (!match) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak tersedia untuk kelas Anda.");
  }
  return match;
}

export async function startOrResumeStudentAttemptService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext,
  securityOptions?: {
    policyReaderSupabase?: SupabaseClient;
    origin?: string;
    headers?: Headers;
  }
): Promise<{
  attemptId: string;
  created: boolean;
  resumed: boolean;
  status: string;
  deadlineAtUtc: string;
  serverNowUtc: string;
}> {
  const context = await requireActiveStudentContext(supabase, actor, "student.attempts.write");
  const parsed = startAttemptSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Permintaan memulai ujian tidak valid."
    );
  }

  let browserAccessDecision: Awaited<ReturnType<typeof enforceBrowserPolicyOnExamAccess>> | null =
    null;
  if (securityOptions?.headers && securityOptions.origin) {
    const secInput = startAttemptSecurityContextSchema.safeParse(rawInput ?? {});
    const secData = secInput.success ? secInput.data : undefined;
    browserAccessDecision = await enforceBrowserPolicyOnExamAccess({
      policyReaderSupabase: securityOptions.policyReaderSupabase ?? supabase,
      examId,
      schoolId: context.schoolId,
      studentId: context.studentId,
      origin: securityOptions.origin,
      headers: securityOptions.headers,
      sebProof: secData?.sebConfigKeyHash || secData?.sebBrowserExamKeyHash
        ? {
            pageUrl: secData.sebPageUrl,
            configKeyHash: secData.sebConfigKeyHash,
            browserExamKeyHash: secData.sebBrowserExamKeyHash,
          }
        : null,
      browserPlatformHint: secData?.browserPlatformHint,
      exambroHint: secData?.exambroHint,
    });
  }

  let result: Awaited<ReturnType<typeof callStartOrResumeAttemptRpc>>;
  try {
    result = await callStartOrResumeAttemptRpc(supabase, {
      examId,
      startIdempotencyKey: parsed.data.startIdempotencyKey,
      clientTimezone: parsed.data.clientTimezone ?? actor.timezone,
    });
  } catch (error) {
    mapRpcError(error, "Gagal memulai sesi ujian.");
  }

  if (browserAccessDecision) {
    try {
      const reader = securityOptions?.policyReaderSupabase ?? supabase;
      await reader
        .from("exam_attempts")
        .update({
          browser_platform: browserAccessDecision.browserPlatform,
          browser_trust_level: browserAccessDecision.trustLevel,
          ...(browserAccessDecision.trustLevel === "verified_seb_header_and_key" ||
          browserAccessDecision.trustLevel === "verified_seb_js_key"
            ? { seb_verified_at_utc: new Date().toISOString() }
            : {}),
        })
        .eq("id", result.attemptId);

      await reader.from("attempt_monitoring_presence").upsert(
        {
          attempt_id: result.attemptId,
          school_id: context.schoolId,
          exam_id: examId,
          student_id: context.studentId,
          presence_state: "RECENTLY_SEEN",
          last_heartbeat_at_utc: new Date().toISOString(),
          browser_platform: browserAccessDecision.browserPlatform,
          browser_trust_level: browserAccessDecision.trustLevel,
        },
        { onConflict: "attempt_id" }
      );
    } catch {
      // Monitoring initialization failure must never abort exam start/resume
    }
  }

  await recordAuditEvent(supabase, {
    schoolId: context.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: result.created ? "attempt.started" : "attempt.resumed",
    entityType: "exam_attempt",
    entityId: result.attemptId,
    summary: result.created
      ? `Siswa memulai sesi ujian baru (${result.attemptId})`
      : `Siswa melanjutkan sesi ujian aktif (${result.attemptId})`,
    metadata: { examId, resumed: result.resumed },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return result;
}

export async function getStudentAttemptWorkspaceService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  securityOptions?: {
    policyReaderSupabase?: SupabaseClient;
    origin?: string;
    headers?: Headers;
  }
): Promise<StudentAttemptWorkspacePayload> {
  const context = await requireActiveStudentContext(supabase, actor, "student.exams.read");
  const workspace = await fetchAttemptWorkspaceData(supabase, context.studentId, attemptId);
  if (!workspace) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
  }

  if (securityOptions?.headers && securityOptions.origin) {
    await enforceBrowserPolicyOnExamAccess({
      policyReaderSupabase: securityOptions.policyReaderSupabase ?? supabase,
      examId: workspace.attempt.examId,
      schoolId: context.schoolId,
      studentId: context.studentId,
      origin: securityOptions.origin,
      headers: securityOptions.headers,
      attemptIdIfExisting: workspace.attempt.id,
    });
  }

  return workspace;
}

export async function syncStudentAttemptTimeService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string
): Promise<AttemptTimeSyncPayload> {
  const context = await requireActiveStudentContext(supabase, actor, "student.exams.read");
  const sync = await fetchAttemptTimeSync(supabase, context.studentId, attemptId);
  if (!sync) {
    throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
  }
  return sync;
}

export async function saveStudentAnswerService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown
): Promise<AuthoritativeAnswerAck> {
  await requireActiveStudentContext(supabase, actor, "student.attempts.write");
  const parsed = saveAnswerSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Payload penyimpanan jawaban tidak valid."
    );
  }

  const input = parsed.data;
  const payloadHash = computeAnswerPayloadHash(input.attemptQuestionId, input.responsePayload);

  try {
    return await callSaveAnswerRpc(supabase, {
      attemptId,
      attemptQuestionId: input.attemptQuestionId,
      idempotencyKey: input.idempotencyKey,
      clientRevision: input.clientRevision,
      responsePayload: input.responsePayload,
      payloadHash,
      isFlaggedForReview: input.isFlaggedForReview,
    });
  } catch (error) {
    mapRpcError(error, "Gagal menyimpan jawaban ke basis data.");
  }
}

export async function toggleStudentFlagService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown
) {
  await requireActiveStudentContext(supabase, actor, "student.attempts.write");
  const parsed = toggleFlagSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Payload penandaan soal tidak valid."
    );
  }

  try {
    return await callToggleFlagRpc(supabase, {
      attemptId,
      attemptQuestionId: parsed.data.attemptQuestionId,
      isFlaggedForReview: parsed.data.isFlaggedForReview,
    });
  } catch (error) {
    mapRpcError(error, "Gagal memperbarui penanda soal.");
  }
}

export async function submitStudentAttemptService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<SubmissionReceipt & { idempotentReplay?: boolean }> {
  const context = await requireActiveStudentContext(supabase, actor, "student.attempts.write");
  const parsed = submitAttemptSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Permintaan pengumpulan ujian tidak valid."
    );
  }

  let receipt: SubmissionReceipt & { idempotentReplay?: boolean };
  try {
    receipt = await callSubmitAttemptRpc(supabase, {
      attemptId,
      idempotencyKey: parsed.data.idempotencyKey,
    });
  } catch (error) {
    mapRpcError(error, "Gagal mengumpulkan ujian.");
  }

  if (!receipt.idempotentReplay) {
    await recordAuditEvent(supabase, {
      schoolId: context.schoolId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      action:
        receipt.attemptStatus === "EXPIRED" ? "attempt.expired" : "attempt.submitted",
      entityType: "exam_attempt",
      entityId: attemptId,
      summary: `Sesi ujian diselesaikan (${receipt.receiptCode})`,
      metadata: {
        examId: receipt.examId,
        answeredCount: receipt.answeredCount,
        totalQuestions: receipt.totalQuestions,
        receiptCode: receipt.receiptCode,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  return receipt;
}

export async function recordStudentTelemetryEventService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawInput: unknown,
  policyReaderSupabase?: SupabaseClient
): Promise<{ recorded: boolean; accepted?: number; deduplicated?: number }> {
  const context = await requireActiveStudentContext(supabase, actor, "student.attempts.write");
  const parsed = clientTelemetryEventSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(400, "VALIDATION_ERROR", "Jenis atau ukuran peristiwa telemetri tidak valid.");
  }

  const normalizedType = normalizeLegacyTelemetryEventType(parsed.data.eventType);

  if (parsed.data.clientEventId) {
    const res = await recordMonitoringEventsBatchService(
      supabase,
      policyReaderSupabase ?? supabase,
      actor,
      attemptId,
      {
        events: [
          {
            clientEventId: parsed.data.clientEventId,
            eventType: normalizedType,
            occurredAt: parsed.data.occurredAt,
            metadata: parsed.data.metadata,
          },
        ],
      }
    );
    return { recorded: true, accepted: res.accepted, deduplicated: res.deduplicated };
  }

  await insertClientTelemetryEvent(supabase, {
    schoolId: context.schoolId,
    attemptId,
    actorUserId: actor.userId,
    eventType: normalizedType,
    metadata: parsed.data.metadata,
  });

  return { recorded: true };
}

export async function getStudentSubmissionReceiptService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string
): Promise<StudentSubmissionReceiptDetail> {
  const context = await requireActiveStudentContext(supabase, actor, "student.results.read");
  const detail = await fetchSubmissionReceiptDetail(
    supabase,
    context,
    actor.fullName,
    attemptId
  );
  if (!detail) {
    throw new ServiceError(404, "RECEIPT_NOT_FOUND", "Bukti pengumpulan ujian tidak ditemukan.");
  }
  return detail;
}

export async function listStudentResultsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<StudentResultListItem[]> {
  const context = await requireActiveStudentContext(supabase, actor, "student.results.read");
  return fetchStudentResultsData(supabase, context);
}
