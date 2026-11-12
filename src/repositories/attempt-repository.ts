import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthoritativeAnswerAck,
  AttemptLifecycleStatus,
  GradingStatus,
  ResultReleaseStatus,
  SubmissionReceipt,
} from "@/domain/exams/contracts";
import type {
  ExamStatus,
  QuestionType,
  ResultReleasePolicy,
} from "@/domain/exams/phase2-types";
import type {
  AttemptQuestionStudentView,
  AttemptStudentOption,
  AttemptTimeSyncPayload,
  ExamAttemptRecord,
  StoredCanonicalAnswerPayload,
  StudentAttemptWorkspacePayload,
  StudentResponsePayload,
  StudentResultListItem,
  StudentSubmissionReceiptDetail,
} from "@/domain/exams/phase3-types";

export interface ActiveStudentEnrollmentContext {
  studentId: string;
  userId: string;
  schoolId: string;
  nis: string | null;
  classId: string;
  className: string;
}

export interface StudentAssignedExamRow {
  examId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  classId: string;
  className: string;
  examStatus: ExamStatus;
  publishedVersionId: string | null;
  durationMinutes: number;
  maxAttempts: number;
  passingScore: number;
  lateJoinMinutes: number;
  requireExamBrowser: boolean;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  resultReleasePolicy: ResultReleasePolicy;
  resultsReleasedAt: string | null;
  allowStudentReview: boolean;
  startsAt: string | null;
  endsAt: string | null;
  questionCount: number;
  totalPoints: number;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: AttemptLifecycleStatus;
    deadlineAtUtc: string;
    submittedAtUtc: string | null;
    receiptCode: string | null;
    gradingStatus: GradingStatus | null;
    releaseStatus: ResultReleaseStatus | null;
  }>;
}

export function sanitizeResponseForStudent(
  questionType: QuestionType,
  raw: StoredCanonicalAnswerPayload | null | undefined
): StudentResponsePayload | null {
  if (!raw) return null;
  if (questionType === "single_choice") {
    return {
      questionType: "single_choice",
      selectedOptionKey: raw.selectedOptionKey ?? null,
    };
  }
  if (questionType === "true_false") {
    return {
      questionType: "true_false",
      selectedOptionKey: raw.selectedOptionKey ?? null,
    };
  }
  if (questionType === "multiple_choice") {
    return {
      questionType: "multiple_choice",
      selectedOptionKeys: Array.isArray(raw.selectedOptionKeys) ? raw.selectedOptionKeys : [],
    };
  }
  return {
    questionType: "essay",
    textAnswer: typeof raw.textAnswer === "string" ? raw.textAnswer : "",
  };
}

export async function getActiveStudentContext(
  supabase: SupabaseClient,
  userId: string,
  schoolId: string
): Promise<ActiveStudentEnrollmentContext | null> {
  const { data: studentRow, error: stuErr } = await supabase
    .from("students")
    .select("id, user_id, school_id, nis, is_active")
    .eq("user_id", userId)
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (stuErr) throw new Error(`Gagal memuat profil siswa: ${stuErr.message}`);
  if (!studentRow) return null;

  const { data: enrollRow, error: enrErr } = await supabase
    .from("class_enrollments")
    .select(
      `
      class_id,
      class:class_id ( id, name )
    `
    )
    .eq("student_id", studentRow.id as string)
    .eq("school_id", schoolId)
    .eq("status", "active")
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (enrErr) throw new Error(`Gagal memuat penempatan kelas siswa: ${enrErr.message}`);
  if (!enrollRow) return null;

  const cls = Array.isArray(enrollRow.class) ? enrollRow.class[0] : enrollRow.class;
  const className = (cls as { name?: string } | null)?.name ?? "Kelas Aktif";

  return {
    studentId: studentRow.id as string,
    userId,
    schoolId,
    nis: (studentRow.nis as string | null) ?? null,
    classId: enrollRow.class_id as string,
    className,
  };
}

interface RawStudentScheduleJoin {
  exam_id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  max_attempts: number;
  late_join_minutes: number;
  require_exam_browser: boolean;
  exam: {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    status: ExamStatus;
    subject_id: string;
    passing_score: number | string;
    randomize_questions: boolean;
    randomize_options: boolean;
    published_version_id: string | null;
    result_release_policy?: ResultReleasePolicy;
    results_released_at?: string | null;
    allow_student_review?: boolean;
    subject?: { code?: string; name?: string } | Array<{ code?: string; name?: string }> | null;
  } | null;
}

export async function fetchStudentAssignedExams(
  supabase: SupabaseClient,
  context: ActiveStudentEnrollmentContext
): Promise<StudentAssignedExamRow[]> {
  const { data: scheduleRows, error: schedErr } = await supabase
    .from("exam_schedules")
    .select(
      `
      exam_id,
      class_id,
      starts_at,
      ends_at,
      duration_minutes,
      max_attempts,
      late_join_minutes,
      require_exam_browser,
      exam:exam_id (
        id,
        title,
        description,
        instructions,
        status,
        subject_id,
        passing_score,
        randomize_questions,
        randomize_options,
        published_version_id,
        result_release_policy,
        results_released_at,
        allow_student_review,
        subject:subject_id ( code, name )
      )
    `
    )
    .eq("school_id", context.schoolId)
    .eq("class_id", context.classId)
    .order("starts_at", { ascending: true });

  if (schedErr) throw new Error(`Gagal memuat jadwal ujian siswa: ${schedErr.message}`);

  const rawSchedules = (scheduleRows ?? []) as unknown as RawStudentScheduleJoin[];
  const visibleSchedules = rawSchedules.filter(
    (s) => s.exam && (s.exam.status === "PUBLISHED" || s.exam.status === "CLOSED")
  );

  if (visibleSchedules.length === 0) {
    return [];
  }

  const examIds = visibleSchedules.map((s) => s.exam_id);
  const versionIds = Array.from(
    new Set(
      visibleSchedules
        .map((s) => s.exam?.published_version_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  );

  // Lazy converge expired active attempts belonging to this student before returning
  const { data: preAttempts } = await supabase
    .from("exam_attempts")
    .select("id, status, deadline_at_utc")
    .eq("student_id", context.studentId)
    .in("exam_id", examIds)
    .in("status", ["IN_PROGRESS", "SUBMITTING"]);

  const nowMs = Date.now();
  for (const att of preAttempts ?? []) {
    const dMs = Date.parse(att.deadline_at_utc as string);
    if (Number.isFinite(dMs) && nowMs > dMs) {
      await supabase.rpc("finalize_expired_attempt_on_access", {
        p_attempt_id: att.id as string,
      });
    }
  }

  const [versionsRes, countsRes, attemptsRes] = await Promise.all([
    versionIds.length > 0
      ? supabase
          .from("exam_versions")
          .select("id, total_points")
          .in("id", versionIds)
      : Promise.resolve({ data: [], error: null }),
    versionIds.length > 0
      ? supabase.rpc("get_student_published_question_counts", {
          p_exam_version_ids: versionIds,
        })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("exam_attempts")
      .select(
        `
        id,
        exam_id,
        attempt_number,
        status,
        deadline_at_utc,
        submitted_at_utc,
        submission_receipts ( receipt_code ),
        exam_grades ( grading_status, release_status )
      `
      )
      .eq("student_id", context.studentId)
      .in("exam_id", examIds)
      .order("attempt_number", { ascending: false }),
  ]);

  if (attemptsRes.error) {
    throw new Error(`Gagal memuat riwayat sesi ujian siswa: ${attemptsRes.error.message}`);
  }

  const totalPointsByVersion = new Map<string, number>();
  for (const row of versionsRes.data ?? []) {
    totalPointsByVersion.set(row.id as string, Number(row.total_points ?? 0));
  }

  const countByVersion = new Map<string, number>();
  for (const row of (countsRes.data ?? []) as Array<{ exam_version_id: string; question_count: number }>) {
    countByVersion.set(row.exam_version_id, Number(row.question_count ?? 0));
  }

  const attemptsByExam = new Map<string, StudentAssignedExamRow["attempts"]>();
  for (const row of attemptsRes.data ?? []) {
    const recArr = Array.isArray(row.submission_receipts)
      ? row.submission_receipts[0]
      : row.submission_receipts;
    const grArr = Array.isArray(row.exam_grades) ? row.exam_grades[0] : row.exam_grades;

    const existing = attemptsByExam.get(row.exam_id as string) ?? [];
    existing.push({
      id: row.id as string,
      attemptNumber: Number(row.attempt_number),
      status: row.status as AttemptLifecycleStatus,
      deadlineAtUtc: row.deadline_at_utc as string,
      submittedAtUtc: (row.submitted_at_utc as string | null) ?? null,
      receiptCode: (recArr as { receipt_code?: string } | null)?.receipt_code ?? null,
      gradingStatus:
        ((grArr as { grading_status?: GradingStatus } | null)?.grading_status as GradingStatus) ??
        null,
      releaseStatus:
        ((grArr as { release_status?: ResultReleaseStatus } | null)
          ?.release_status as ResultReleaseStatus) ?? null,
    });
    attemptsByExam.set(row.exam_id as string, existing);
  }

  return visibleSchedules.map((sched) => {
    const exam = sched.exam!;
    const subj = Array.isArray(exam.subject) ? exam.subject[0] : exam.subject;
    const versionId = exam.published_version_id;

    return {
      examId: exam.id,
      title: exam.title,
      description: exam.description ?? null,
      instructions: exam.instructions ?? null,
      subjectId: exam.subject_id,
      subjectName: subj?.name ?? "-",
      subjectCode: subj?.code ?? "-",
      classId: context.classId,
      className: context.className,
      examStatus: exam.status,
      publishedVersionId: versionId,
      durationMinutes: sched.duration_minutes,
      maxAttempts: sched.max_attempts,
      passingScore: Number(exam.passing_score ?? 70),
      lateJoinMinutes: sched.late_join_minutes,
      requireExamBrowser: sched.require_exam_browser,
      randomizeQuestions: exam.randomize_questions,
      randomizeOptions: exam.randomize_options,
      resultReleasePolicy: exam.result_release_policy ?? "manual",
      resultsReleasedAt: exam.results_released_at ?? null,
      allowStudentReview: Boolean(exam.allow_student_review ?? false),
      startsAt: sched.starts_at,
      endsAt: sched.ends_at,
      questionCount: versionId ? (countByVersion.get(versionId) ?? 0) : 0,
      totalPoints: versionId ? (totalPointsByVersion.get(versionId) ?? 0) : 0,
      attempts: attemptsByExam.get(exam.id) ?? [],
    };
  });
}

export async function callStartOrResumeAttemptRpc(
  supabase: SupabaseClient,
  params: {
    examId: string;
    startIdempotencyKey?: string;
    clientTimezone?: string | null;
  }
): Promise<{
  attemptId: string;
  created: boolean;
  resumed: boolean;
  status: AttemptLifecycleStatus;
  deadlineAtUtc: string;
  serverNowUtc: string;
}> {
  const { data, error } = await supabase.rpc("start_or_resume_exam_attempt", {
    p_exam_id: params.examId,
    p_start_idempotency_key: params.startIdempotencyKey ?? null,
    p_client_timezone: params.clientTimezone ?? null,
  });

  if (error) {
    throw error;
  }
  return data as {
    attemptId: string;
    created: boolean;
    resumed: boolean;
    status: AttemptLifecycleStatus;
    deadlineAtUtc: string;
    serverNowUtc: string;
  };
}

export async function fetchAttemptWorkspaceData(
  supabase: SupabaseClient,
  studentId: string,
  attemptId: string
): Promise<StudentAttemptWorkspacePayload | null> {
  // Perform lazy expiration check atomically if attempt passed server UTC deadline
  await supabase.rpc("finalize_expired_attempt_on_access", {
    p_attempt_id: attemptId,
  });

  const { data: attemptRow, error: attErr } = await supabase
    .from("exam_attempts")
    .select(
      `
      id,
      school_id,
      exam_id,
      exam_version_id,
      student_id,
      class_id,
      attempt_number,
      status,
      started_at_utc,
      deadline_at_utc,
      submitted_at_utc,
      last_activity_at_utc,
      time_extension_minutes,
      cancellation_reason,
      cancelled_by,
      cancelled_at_utc,
      exam:exam_id (
        title,
        instructions,
        subject:subject_id ( name )
      )
    `
    )
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (attErr) throw new Error(`Gagal memuat sesi ujian: ${attErr.message}`);
  if (!attemptRow) return null;

  const [schedRes, qaRes, ansRes] = await Promise.all([
    supabase
      .from("exam_schedules")
      .select("duration_minutes, require_exam_browser")
      .eq("exam_id", attemptRow.exam_id as string)
      .eq("class_id", attemptRow.class_id as string)
      .maybeSingle(),
    supabase
      .from("attempt_question_assignments")
      .select("id, display_index, question_type, stem_snapshot, points_snapshot, options_snapshot")
      .eq("attempt_id", attemptId)
      .order("display_index", { ascending: true }),
    supabase
      .from("student_answers")
      .select(
        "attempt_question_id, latest_revision, response_payload, is_flagged_for_review, committed_at_utc"
      )
      .eq("attempt_id", attemptId),
  ]);

  if (qaRes.error) throw new Error(`Gagal memuat soal sesi ujian: ${qaRes.error.message}`);
  if (ansRes.error) throw new Error(`Gagal memuat jawaban tersimpan: ${ansRes.error.message}`);

  const answerByQaId = new Map<
    string,
    {
      latestRevision: number;
      responsePayload: StoredCanonicalAnswerPayload;
      isFlaggedForReview: boolean;
      committedAtUtc: string | null;
    }
  >();

  for (const row of ansRes.data ?? []) {
    answerByQaId.set(row.attempt_question_id as string, {
      latestRevision: Number(row.latest_revision ?? 0),
      responsePayload: (row.response_payload ?? {}) as StoredCanonicalAnswerPayload,
      isFlaggedForReview: Boolean(row.is_flagged_for_review),
      committedAtUtc: (row.committed_at_utc as string | null) ?? null,
    });
  }

  const questions: AttemptQuestionStudentView[] = (qaRes.data ?? []).map((qa) => {
    const qType = qa.question_type as QuestionType;
    const saved = answerByQaId.get(qa.id as string);
    return {
      attemptQuestionId: qa.id as string,
      displayIndex: Number(qa.display_index),
      questionType: qType,
      stem: qa.stem_snapshot as string,
      points: Number(qa.points_snapshot),
      options: (qa.options_snapshot ?? []) as AttemptStudentOption[],
      currentResponse: saved ? sanitizeResponseForStudent(qType, saved.responsePayload) : null,
      latestRevision: saved?.latestRevision ?? 0,
      isFlaggedForReview: saved?.isFlaggedForReview ?? false,
      committedAtUtc: saved?.committedAtUtc ?? null,
    };
  });

  const nowMs = Date.now();
  const deadlineMs = Date.parse(attemptRow.deadline_at_utc as string);
  const remainingMs = Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - nowMs) : 0;

  const examJoin = Array.isArray(attemptRow.exam) ? attemptRow.exam[0] : attemptRow.exam;
  const subjJoin = examJoin
    ? Array.isArray((examJoin as { subject?: unknown }).subject)
      ? ((examJoin as { subject: Array<{ name?: string }> }).subject[0])
      : (examJoin as { subject?: { name?: string } | null }).subject
    : null;

  const attempt: ExamAttemptRecord = {
    id: attemptRow.id as string,
    schoolId: attemptRow.school_id as string,
    examId: attemptRow.exam_id as string,
    examVersionId: attemptRow.exam_version_id as string,
    studentId: attemptRow.student_id as string,
    classId: attemptRow.class_id as string,
    attemptNumber: Number(attemptRow.attempt_number),
    status: attemptRow.status as AttemptLifecycleStatus,
    startedAtUtc: attemptRow.started_at_utc as string,
    deadlineAtUtc: attemptRow.deadline_at_utc as string,
    submittedAtUtc: (attemptRow.submitted_at_utc as string | null) ?? null,
    lastActivityAtUtc: attemptRow.last_activity_at_utc as string,
    timeExtensionMinutes: Number(attemptRow.time_extension_minutes ?? 0),
    cancellationReason: (attemptRow.cancellation_reason as string | null) ?? null,
    cancelledBy: (attemptRow.cancelled_by as string | null) ?? null,
    cancelledAtUtc: (attemptRow.cancelled_at_utc as string | null) ?? null,
  };

  return {
    attempt,
    examTitle: (examJoin as { title?: string } | null)?.title ?? "Ujian",
    subjectName: subjJoin?.name ?? "-",
    instructions: (examJoin as { instructions?: string | null } | null)?.instructions ?? null,
    durationMinutes: Number(schedRes.data?.duration_minutes ?? 60),
    requireExamBrowser: Boolean(schedRes.data?.require_exam_browser ?? true),
    serverNowUtc: new Date(nowMs).toISOString(),
    remainingMs,
    questions,
  };
}

export async function fetchAttemptTimeSync(
  supabase: SupabaseClient,
  studentId: string,
  attemptId: string
): Promise<AttemptTimeSyncPayload | null> {
  const { data: rpcRes } = await supabase.rpc("finalize_expired_attempt_on_access", {
    p_attempt_id: attemptId,
  });

  const { data: row, error } = await supabase
    .from("exam_attempts")
    .select("id, status, deadline_at_utc")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw new Error(`Gagal menyinkronkan waktu sesi: ${error.message}`);
  if (!row) return null;

  const nowMs = Date.now();
  const deadlineMs = Date.parse(row.deadline_at_utc as string);
  const rpcStatus = (rpcRes as { attemptStatus?: AttemptLifecycleStatus; status?: AttemptLifecycleStatus } | null)
    ?.attemptStatus ?? (rpcRes as { status?: AttemptLifecycleStatus } | null)?.status;

  return {
    attemptId: row.id as string,
    status: rpcStatus ?? (row.status as AttemptLifecycleStatus),
    serverNowUtc: new Date(nowMs).toISOString(),
    deadlineAtUtc: row.deadline_at_utc as string,
    remainingMs: Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - nowMs) : 0,
  };
}

export async function callSaveAnswerRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    attemptQuestionId: string;
    idempotencyKey: string;
    clientRevision: number;
    responsePayload: StudentResponsePayload;
    payloadHash: string;
    isFlaggedForReview?: boolean;
  }
): Promise<AuthoritativeAnswerAck> {
  const { data, error } = await supabase.rpc("save_attempt_answer_atomic", {
    p_attempt_id: params.attemptId,
    p_attempt_question_id: params.attemptQuestionId,
    p_idempotency_key: params.idempotencyKey,
    p_client_revision: params.clientRevision,
    p_response_payload: params.responsePayload,
    p_payload_hash: params.payloadHash,
    p_is_flagged: params.isFlaggedForReview ?? null,
  });

  if (error) throw error;
  return data as AuthoritativeAnswerAck;
}

export async function callToggleFlagRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    attemptQuestionId: string;
    isFlaggedForReview: boolean;
  }
): Promise<{
  attemptId: string;
  attemptQuestionId: string;
  isFlaggedForReview: boolean;
  serverNowUtc: string;
}> {
  const { data, error } = await supabase.rpc("toggle_attempt_question_flag", {
    p_attempt_id: params.attemptId,
    p_attempt_question_id: params.attemptQuestionId,
    p_is_flagged: params.isFlaggedForReview,
  });
  if (error) throw error;
  return data as {
    attemptId: string;
    attemptQuestionId: string;
    isFlaggedForReview: boolean;
    serverNowUtc: string;
  };
}

export async function callSubmitAttemptRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    idempotencyKey: string;
  }
): Promise<SubmissionReceipt & { idempotentReplay?: boolean }> {
  const { data, error } = await supabase.rpc("submit_exam_attempt_atomic", {
    p_attempt_id: params.attemptId,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) throw error;
  return data as SubmissionReceipt & { idempotentReplay?: boolean };
}

export async function insertClientTelemetryEvent(
  supabase: SupabaseClient,
  params: {
    schoolId: string;
    attemptId: string;
    actorUserId: string;
    eventType: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("attempt_events").insert({
    school_id: params.schoolId,
    attempt_id: params.attemptId,
    actor_user_id: params.actorUserId,
    event_source: "client_reported",
    event_type: params.eventType,
    metadata: params.metadata,
  });

  if (error) {
    throw new Error(`Gagal mencatat telemetri aktivitas: ${error.message}`);
  }
}

export async function fetchSubmissionReceiptDetail(
  supabase: SupabaseClient,
  context: ActiveStudentEnrollmentContext,
  studentFullName: string,
  attemptId: string
): Promise<StudentSubmissionReceiptDetail | null> {
  await supabase.rpc("finalize_expired_attempt_on_access", {
    p_attempt_id: attemptId,
  });

  const { data: receiptRow, error } = await supabase
    .from("submission_receipts")
    .select(
      `
      id,
      receipt_code,
      attempt_id,
      exam_id,
      exam_version_id,
      answered_count,
      total_questions,
      integrity_digest,
      issued_at_utc,
      attempt:attempt_id (
        attempt_number,
        status,
        started_at_utc,
        submitted_at_utc,
        class:class_id ( name )
      ),
      exam:exam_id (
        title,
        result_release_policy,
        subject:subject_id ( name )
      )
    `
    )
    .eq("attempt_id", attemptId)
    .eq("student_id", context.studentId)
    .maybeSingle();

  if (error) throw new Error(`Gagal memuat bukti pengumpulan: ${error.message}`);
  if (!receiptRow) return null;

  const { data: gradeRow } = await supabase
    .from("exam_grades")
    .select("grading_status, release_status")
    .eq("attempt_id", attemptId)
    .eq("student_id", context.studentId)
    .maybeSingle();

  const att = Array.isArray(receiptRow.attempt) ? receiptRow.attempt[0] : receiptRow.attempt;
  const ex = Array.isArray(receiptRow.exam) ? receiptRow.exam[0] : receiptRow.exam;
  const cls = att && Array.isArray((att as { class?: unknown }).class)
    ? ((att as { class: Array<{ name?: string }> }).class[0])
    : (att as { class?: { name?: string } } | null)?.class;
  const subj = ex && Array.isArray((ex as { subject?: unknown }).subject)
    ? ((ex as { subject: Array<{ name?: string }> }).subject[0])
    : (ex as { subject?: { name?: string } } | null)?.subject;

  const gradingStatus =
    (gradeRow?.grading_status as GradingStatus | undefined) ?? null;
  const releaseStatus =
    (gradeRow?.release_status as ResultReleaseStatus | undefined) ?? null;

  return {
    receiptId: receiptRow.id as string,
    receiptCode: receiptRow.receipt_code as string,
    attemptId: receiptRow.attempt_id as string,
    examId: receiptRow.exam_id as string,
    examVersionId: receiptRow.exam_version_id as string,
    examTitle: (ex as { title?: string } | null)?.title ?? "Ujian",
    subjectName: subj?.name ?? "-",
    studentName: studentFullName,
    studentNis: context.nis,
    className: cls?.name ?? context.className,
    attemptNumber: Number((att as { attempt_number?: number } | null)?.attempt_number ?? 1),
    attemptStatus:
      ((att as { status?: string } | null)?.status === "EXPIRED" ? "EXPIRED" : "SUBMITTED"),
    startedAtUtc: (att as { started_at_utc?: string } | null)?.started_at_utc ?? (receiptRow.issued_at_utc as string),
    submittedAtUtc:
      (att as { submitted_at_utc?: string | null } | null)?.submitted_at_utc ??
      (receiptRow.issued_at_utc as string),
    answeredCount: Number(receiptRow.answered_count),
    totalQuestions: Number(receiptRow.total_questions),
    integrityDigest: receiptRow.integrity_digest as string,
    resultReleasePolicy:
      ((ex as { result_release_policy?: ResultReleasePolicy } | null)?.result_release_policy) ??
      "manual",
    gradingStatus,
    releaseStatus,
    canViewResultNow: releaseStatus === "RELEASED",
  };
}

export async function fetchStudentResultsData(
  supabase: SupabaseClient,
  context: ActiveStudentEnrollmentContext
): Promise<StudentResultListItem[]> {
  const { data: attempts, error: attErr } = await supabase
    .from("exam_attempts")
    .select(
      `
      id,
      exam_id,
      class_id,
      attempt_number,
      status,
      submitted_at_utc,
      exam:exam_id (
        title,
        passing_score,
        result_release_policy,
        allow_student_review,
        subject:subject_id ( name )
      ),
      exam_version:exam_version_id ( passing_score ),
      submission_receipts ( receipt_code )
    `
    )
    .eq("student_id", context.studentId)
    .in("status", ["SUBMITTED", "EXPIRED", "CANCELLED_BY_ADMIN"])
    .order("submitted_at_utc", { ascending: false, nullsFirst: false });

  if (attErr) throw new Error(`Gagal memuat hasil ujian siswa: ${attErr.message}`);
  if (!attempts || attempts.length === 0) return [];

  const attemptIds = attempts.map((a) => a.id as string);
  // RLS returns exam_grades rows ONLY when released/visible to the student!
  const { data: visibleGrades } = await supabase
    .from("exam_grades")
    .select("*")
    .eq("student_id", context.studentId)
    .in("attempt_id", attemptIds);

  const gradeByAttempt = new Map<string, Record<string, unknown>>();
  for (const g of visibleGrades ?? []) {
    gradeByAttempt.set(g.attempt_id as string, g as Record<string, unknown>);
  }

  return attempts.map((row) => {
    const examJoin = Array.isArray(row.exam) ? row.exam[0] : row.exam;
    const subjJoin = examJoin && Array.isArray((examJoin as { subject?: unknown }).subject)
      ? ((examJoin as { subject: Array<{ name?: string }> }).subject[0])
      : (examJoin as { subject?: { name?: string } } | null)?.subject;
    const verJoin = Array.isArray(row.exam_version)
      ? row.exam_version[0]
      : row.exam_version;
    const recJoin = Array.isArray(row.submission_receipts)
      ? row.submission_receipts[0]
      : row.submission_receipts;

    const visibleGrade = gradeByAttempt.get(row.id as string);
    const status = row.status as AttemptLifecycleStatus;
    const isCancelled = status === "CANCELLED_BY_ADMIN";

    let withheldReason: string | null = null;
    if (!visibleGrade) {
      if (isCancelled) {
        withheldReason = "Sesi ujian dibatalkan oleh administrator.";
      } else {
        withheldReason = "Hasil menunggu rilis guru atau penyelesaian penilaian esai.";
      }
    }

    return {
      attemptId: row.id as string,
      examId: row.exam_id as string,
      examTitle: (examJoin as { title?: string } | null)?.title ?? "Ujian",
      subjectName: subjJoin?.name ?? "-",
      attemptNumber: Number(row.attempt_number),
      attemptStatus: status,
      submittedAtUtc: (row.submitted_at_utc as string | null) ?? null,
      receiptCode: (recJoin as { receipt_code?: string } | null)?.receipt_code ?? null,
      gradingStatus: (visibleGrade?.grading_status as GradingStatus | undefined) ?? null,
      releaseStatus:
        (visibleGrade?.release_status as ResultReleaseStatus | undefined) ?? "UNRELEASED",
      resultsVisible: Boolean(visibleGrade),
      withheldReason,
      objectiveScore: visibleGrade ? Number(visibleGrade.objective_score) : null,
      manualScore: visibleGrade ? Number(visibleGrade.manual_score) : null,
      adjustmentDelta: visibleGrade ? Number(visibleGrade.adjustment_delta) : null,
      totalScore: visibleGrade ? Number(visibleGrade.total_score) : null,
      maxScore: visibleGrade ? Number(visibleGrade.max_score) : null,
      percentageScore: visibleGrade ? Number(visibleGrade.percentage_score) : null,
      passingScore: verJoin
        ? Number((verJoin as { passing_score?: number | string }).passing_score ?? 70)
        : Number((examJoin as { passing_score?: number | string } | null)?.passing_score ?? 70),
      passed: visibleGrade ? Boolean(visibleGrade.passed) : null,
      allowStudentReview: Boolean(
        (examJoin as { allow_student_review?: boolean } | null)?.allow_student_review ?? false
      ),
    };
  });
}
