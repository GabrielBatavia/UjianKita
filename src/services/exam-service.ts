import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type {
  ExamClassAssignmentItem,
  ExamDraftQuestionItem,
  ExamPublicationEventItem,
  ExamRecord,
  ExamScheduleItem,
  ExamStatus,
  ExamVersionSummary,
  StudentExamPreviewPayload,
  TeacherExamReviewPayload,
} from "@/domain/exams/phase2-types";
import {
  canTransitionExamStatus,
  detectScheduleConflicts,
  isExamEditable,
  validateExamReadiness,
  type ExamReadinessValidation,
  type ScheduleConflictWarning,
} from "@/domain/exams/exam-lifecycle";
import { hasPermission, hasRole } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import {
  buildStudentSafeExamPreview,
  buildTeacherReviewExamPreview,
  fetchExamDetail,
  fetchExamsList,
  fetchSchoolSchedules,
} from "@/repositories/exam-repository";
import {
  createExamSchema,
  examStatusTransitionSchema,
  publishExamSchema,
  updateExamDraftQuestionsSchema,
  updateExamScheduleSchema,
  updateExamSchema,
} from "@/schemas/exams";
import { ServiceError } from "@/services/errors";
import type { RequestAuditContext } from "@/services/admin-service";
import { getAuthorizedSubjectIdsForActor } from "@/services/question-bank-service";

export async function getAuthorizedClassesForActor(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<Array<{ id: string; name: string; grade_level: string; academic_year_id: string }>> {
  if (hasRole(actor.roles, "admin")) {
    const { data, error } = await supabase
      .from("classes")
      .select("id, name, grade_level, academic_year_id")
      .eq("school_id", actor.schoolId)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw new Error(`Gagal memuat kelas: ${error.message}`);
    return (data ?? []) as Array<{
      id: string;
      name: string;
      grade_level: string;
      academic_year_id: string;
    }>;
  }

  if (!hasRole(actor.roles, "teacher")) return [];

  const { data: teacherRow } = await supabase
    .from("teachers")
    .select("id")
    .eq("user_id", actor.userId)
    .eq("school_id", actor.schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (!teacherRow) return [];

  const [assignRes, homeroomRes] = await Promise.all([
    supabase
      .from("teacher_assignments")
      .select("class:class_id ( id, name, grade_level, academic_year_id, is_active )")
      .eq("teacher_id", teacherRow.id)
      .eq("school_id", actor.schoolId)
      .eq("is_active", true),
    supabase
      .from("classes")
      .select("id, name, grade_level, academic_year_id, is_active")
      .eq("homeroom_teacher_id", teacherRow.id)
      .eq("school_id", actor.schoolId)
      .eq("is_active", true),
  ]);

  const classMap = new Map<
    string,
    { id: string; name: string; grade_level: string; academic_year_id: string }
  >();

  for (const hr of homeroomRes.data ?? []) {
    classMap.set(hr.id as string, {
      id: hr.id as string,
      name: hr.name as string,
      grade_level: hr.grade_level as string,
      academic_year_id: hr.academic_year_id as string,
    });
  }

  for (const row of assignRes.data ?? []) {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    if (cls && (cls as { is_active?: boolean }).is_active !== false) {
      const c = cls as { id: string; name: string; grade_level: string; academic_year_id: string };
      classMap.set(c.id, c);
    }
  }

  return Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function assertExamAccess(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  requiredPermission: "exams.read" | "exams.write" | "exams.publish" | "exams.oversight"
): Promise<{
  exam: ExamRecord;
  draftQuestions: ExamDraftQuestionItem[];
  assignments: ExamClassAssignmentItem[];
  schedules: ExamScheduleItem[];
  publishedVersions: ExamVersionSummary[];
  publicationEvents: ExamPublicationEventItem[];
}> {
  if (!actor.isActive || !hasPermission(actor.roles, requiredPermission)) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk operasi ujian ini.");
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
        "Anda hanya dapat mengelola ujian untuk mata pelajaran yang ditugaskan kepada Anda."
      );
    }
  }

  return detail;
}

export async function listExamsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  filters: {
    subjectId?: string;
    status?: ExamStatus;
    classId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{
  exams: ExamRecord[];
  total: number;
  page: number;
  pageSize: number;
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
  authorizedClasses: Array<{ id: string; name: string; grade_level: string; academic_year_id: string }>;
}> {
  if (!actor.isActive || !hasPermission(actor.roles, "exams.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses daftar ujian ditolak.");
  }

  const [authorizedSubjects, authorizedClasses] = await Promise.all([
    getAuthorizedSubjectIdsForActor(supabase, actor),
    getAuthorizedClassesForActor(supabase, actor),
  ]);

  if (filters.subjectId && !authorizedSubjects.some((s) => s.id === filters.subjectId)) {
    throw new ServiceError(403, "SUBJECT_FORBIDDEN", "Mata pelajaran di luar penugasan Anda.");
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 20));

  const { exams, total } = await fetchExamsList(supabase, {
    schoolId: actor.schoolId,
    subjectId: filters.subjectId,
    status: filters.status,
    classId: filters.classId,
    search: filters.search,
    page,
    pageSize,
  });

  // For teachers, scope to authorized subjects
  const subjectSet = new Set(authorizedSubjects.map((s) => s.id));
  const scopedExams = hasRole(actor.roles, "admin")
    ? exams
    : exams.filter((e) => subjectSet.has(e.subject_id));

  return {
    exams: scopedExams,
    total: hasRole(actor.roles, "admin") ? total : scopedExams.length,
    page,
    pageSize,
    authorizedSubjects,
    authorizedClasses,
  };
}

export async function getExamDetailService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string
): Promise<{
  exam: ExamRecord;
  draftQuestions: ExamDraftQuestionItem[];
  assignments: ExamClassAssignmentItem[];
  schedules: ExamScheduleItem[];
  publishedVersions: ExamVersionSummary[];
  publicationEvents: ExamPublicationEventItem[];
  readiness: ExamReadinessValidation;
  conflicts: ScheduleConflictWarning[];
  authorizedClasses: Array<{ id: string; name: string; grade_level: string; academic_year_id: string }>;
}> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.read");
  const [schoolSchedules, authorizedClasses] = await Promise.all([
    fetchSchoolSchedules(supabase, actor.schoolId),
    getAuthorizedClassesForActor(supabase, actor),
  ]);

  const readiness = validateExamReadiness({
    exam: detail.exam,
    draftQuestions: detail.draftQuestions,
    assignments: detail.assignments,
  });

  const conflicts = detectScheduleConflicts({
    examId: detail.exam.id,
    startsAt: detail.exam.starts_at,
    endsAt: detail.exam.ends_at,
    assignedClassIds: detail.assignments.map((a) => a.class_id),
    schoolSchedules,
  });

  return {
    ...detail,
    readiness,
    conflicts,
    authorizedClasses,
  };
}

export async function createExamService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ examId: string }> {
  if (!actor.isActive || !hasPermission(actor.roles, "exams.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin membuat ujian.");
  }

  const parsed = createExamSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data ujian tidak valid."
    );
  }
  const input = parsed.data;

  const [authorizedSubjects, authorizedClasses] = await Promise.all([
    getAuthorizedSubjectIdsForActor(supabase, actor),
    getAuthorizedClassesForActor(supabase, actor),
  ]);

  if (!authorizedSubjects.some((s) => s.id === input.subjectId)) {
    throw new ServiceError(
      403,
      "SUBJECT_FORBIDDEN",
      "Anda tidak ditugaskan mengajar mata pelajaran ini."
    );
  }

  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new ServiceError(400, "INVALID_WINDOW", "Waktu selesai harus lebih lambat daripada waktu mulai.");
  }

  const allowedClassSet = new Set(authorizedClasses.map((c) => c.id));
  for (const cid of input.classIds) {
    if (!allowedClassSet.has(cid)) {
      throw new ServiceError(
        403,
        "CLASS_FORBIDDEN",
        "Terdapat kelas di luar penugasan Anda atau di luar sekolah ini."
      );
    }
  }

  const { data: created, error } = await supabase
    .from("exams")
    .insert({
      school_id: actor.schoolId,
      subject_id: input.subjectId,
      academic_year_id: input.academicYearId,
      created_by: actor.userId,
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      status: "DRAFT",
      duration_minutes: input.durationMinutes,
      max_attempts: input.maxAttempts,
      passing_score: input.passingScore,
      randomize_questions: input.randomizeQuestions,
      randomize_options: input.randomizeOptions,
      result_release_policy: input.resultReleasePolicy,
      allow_student_review: input.allowStudentReview,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new ServiceError(400, "EXAM_CREATE_FAILED", error?.message ?? "Gagal membuat draf ujian.");
  }

  const examId = created.id as string;

  if (input.classIds.length > 0) {
    const { error: assignErr } = await supabase.from("exam_assignments").insert(
      input.classIds.map((cid) => ({
        school_id: actor.schoolId,
        exam_id: examId,
        class_id: cid,
        assigned_by: actor.userId,
      }))
    );
    if (assignErr) {
      throw new ServiceError(400, "EXAM_ASSIGN_FAILED", "Ujian dibuat tetapi gagal menetapkan kelas.");
    }

    if (input.startsAt && input.endsAt) {
      await supabase.from("exam_schedules").insert(
        input.classIds.map((cid) => ({
          school_id: actor.schoolId,
          exam_id: examId,
          class_id: cid,
          starts_at: input.startsAt!,
          ends_at: input.endsAt!,
          duration_minutes: input.durationMinutes,
          max_attempts: input.maxAttempts,
        }))
      );
    }
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "exam.created",
    entityType: "exam",
    entityId: examId,
    summary: `Membuat draf ujian "${input.title}"`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { examId };
}

export async function updateExamService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ versionLock: number }> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.write");
  if (!isExamEditable(detail.exam.status)) {
    throw new ServiceError(
      409,
      "EXAM_IMMUTABLE",
      `Ujian berstatus ${detail.exam.status} tidak dapat diubah secara langsung. Gunakan alur Revisi Baru.`
    );
  }

  const parsed = updateExamSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan ujian tidak valid."
    );
  }
  const input = parsed.data;

  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new ServiceError(400, "INVALID_WINDOW", "Waktu selesai harus setelah waktu mulai.");
  }

  const nextLock = detail.exam.version_lock + 1;

  const { data: updated, error } = await supabase
    .from("exams")
    .update({
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      academic_year_id: input.academicYearId,
      duration_minutes: input.durationMinutes,
      max_attempts: input.maxAttempts,
      passing_score: input.passingScore,
      randomize_questions: input.randomizeQuestions,
      randomize_options: input.randomizeOptions,
      result_release_policy: input.resultReleasePolicy,
      allow_student_review: input.allowStudentReview,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      status: "DRAFT",
      version_lock: nextLock,
    })
    .eq("id", examId)
    .eq("school_id", actor.schoolId)
    .eq("version_lock", input.versionLock)
    .select("version_lock")
    .maybeSingle();

  if (error) {
    throw new ServiceError(400, "EXAM_UPDATE_FAILED", "Gagal memperbarui konfigurasi ujian.");
  }
  if (!updated) {
    throw new ServiceError(
      409,
      "CONCURRENCY_CONFLICT",
      "Ujian telah diperbarui oleh sesi lain. Muat ulang halaman sebelum menyimpan."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "exam.updated",
    entityType: "exam",
    entityId: examId,
    summary: `Memperbarui konfigurasi draf ujian "${input.title}"`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { versionLock: updated.version_lock as number };
}

export async function updateExamDraftQuestionsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ versionLock: number; totalQuestions: number }> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.write");
  if (!isExamEditable(detail.exam.status)) {
    throw new ServiceError(
      409,
      "EXAM_IMMUTABLE",
      "Daftar soal tidak dapat diubah setelah ujian diterbitkan."
    );
  }

  const parsed = updateExamDraftQuestionsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Daftar soal ujian tidak valid."
    );
  }
  const input = parsed.data;

  // Verify every question belongs to the school, matches the exam subject, and is not archived
  const uniqueIds = Array.from(new Set(input.items.map((i) => i.questionId)));
  if (uniqueIds.length !== input.items.length) {
    throw new ServiceError(400, "DUPLICATE_QUESTION", "Soal yang sama tidak boleh dipilih dua kali.");
  }

  if (uniqueIds.length > 0) {
    const { data: bankRows, error: qErr } = await supabase
      .from("questions")
      .select("id, school_id, subject_id, status, current_version_id")
      .in("id", uniqueIds)
      .eq("school_id", actor.schoolId);

    if (qErr || !bankRows || bankRows.length !== uniqueIds.length) {
      throw new ServiceError(400, "INVALID_QUESTION_REF", "Terdapat soal yang tidak ditemukan pada sekolah ini.");
    }

    for (const q of bankRows) {
      if (q.subject_id !== detail.exam.subject_id) {
        throw new ServiceError(
          400,
          "SUBJECT_MISMATCH",
          "Semua soal ujian harus berasal dari mata pelajaran yang sama dengan ujian."
        );
      }
      if (q.status === "archived" || !q.current_version_id) {
        throw new ServiceError(
          400,
          "QUESTION_UNAVAILABLE",
          "Soal yang diarsipkan atau belum lengkap tidak dapat ditambahkan ke ujian."
        );
      }
    }
  }

  // Optimistic lock bump first
  const nextLock = detail.exam.version_lock + 1;
  const { data: lockedExam, error: lockErr } = await supabase
    .from("exams")
    .update({ status: "DRAFT", version_lock: nextLock })
    .eq("id", examId)
    .eq("school_id", actor.schoolId)
    .eq("version_lock", input.versionLock)
    .select("version_lock")
    .maybeSingle();

  if (lockErr || !lockedExam) {
    throw new ServiceError(
      409,
      "CONCURRENCY_CONFLICT",
      "Ujian diubah oleh sesi lain. Muat ulang daftar soal."
    );
  }

  await supabase.from("exam_draft_questions").delete().eq("exam_id", examId);

  if (input.items.length > 0) {
    const { error: insertErr } = await supabase.from("exam_draft_questions").insert(
      input.items.map((item, idx) => ({
        school_id: actor.schoolId,
        exam_id: examId,
        question_id: item.questionId,
        display_order: idx + 1,
        points_override: item.pointsOverride ?? null,
        preserve_order: item.preserveOrder,
      }))
    );
    if (insertErr) {
      throw new ServiceError(400, "EXAM_QUESTIONS_SAVE_FAILED", "Gagal menyimpan susunan soal.");
    }
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "exam.questions_updated",
    entityType: "exam",
    entityId: examId,
    summary: `Memperbarui susunan ${input.items.length} soal pada draf ujian "${detail.exam.title}"`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { versionLock: lockedExam.version_lock as number, totalQuestions: input.items.length };
}

export async function updateExamScheduleService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ versionLock: number; conflicts: ScheduleConflictWarning[] }> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.write");
  if (!isExamEditable(detail.exam.status)) {
    throw new ServiceError(
      409,
      "EXAM_IMMUTABLE",
      "Jadwal ujian yang sudah diterbitkan memerlukan alur Revisi Baru."
    );
  }

  const parsed = updateExamScheduleSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Konfigurasi jadwal ujian tidak valid."
    );
  }
  const input = parsed.data;

  const startMs = new Date(input.startsAt).getTime();
  const endMs = new Date(input.endsAt).getTime();
  if (endMs <= startMs) {
    throw new ServiceError(400, "INVALID_WINDOW", "Waktu selesai harus setelah waktu mulai.");
  }
  if ((endMs - startMs) / 60_000 < input.durationMinutes) {
    throw new ServiceError(
      400,
      "WINDOW_SHORTER_THAN_DURATION",
      "Rentang waktu ketersediaan ujian tidak boleh lebih pendek daripada durasi pengerjaan."
    );
  }

  const authorizedClasses = await getAuthorizedClassesForActor(supabase, actor);
  const allowedClassSet = new Set(authorizedClasses.map((c) => c.id));
  const uniqueClassIds = Array.from(new Set(input.classIds));

  for (const cid of uniqueClassIds) {
    if (!allowedClassSet.has(cid)) {
      throw new ServiceError(
        403,
        "CLASS_FORBIDDEN",
        "Anda tidak memiliki akses ke salah satu kelas yang dipilih."
      );
    }
  }

  const nextLock = detail.exam.version_lock + 1;
  const { data: lockedExam, error: lockErr } = await supabase
    .from("exams")
    .update({
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      duration_minutes: input.durationMinutes,
      max_attempts: input.maxAttempts,
      status: "DRAFT",
      version_lock: nextLock,
    })
    .eq("id", examId)
    .eq("school_id", actor.schoolId)
    .eq("version_lock", input.versionLock)
    .select("version_lock")
    .maybeSingle();

  if (lockErr || !lockedExam) {
    throw new ServiceError(409, "CONCURRENCY_CONFLICT", "Ujian telah diperbarui oleh sesi lain.");
  }

  await supabase.from("exam_assignments").delete().eq("exam_id", examId);
  await supabase.from("exam_schedules").delete().eq("exam_id", examId);

  const { error: assignErr } = await supabase.from("exam_assignments").insert(
    uniqueClassIds.map((cid) => ({
      school_id: actor.schoolId,
      exam_id: examId,
      class_id: cid,
      assigned_by: actor.userId,
    }))
  );
  if (assignErr) {
    throw new ServiceError(400, "ASSIGNMENT_SAVE_FAILED", "Gagal menyimpan kelas peserta.");
  }

  const { error: schedErr } = await supabase.from("exam_schedules").insert(
    uniqueClassIds.map((cid) => ({
      school_id: actor.schoolId,
      exam_id: examId,
      class_id: cid,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      duration_minutes: input.durationMinutes,
      max_attempts: input.maxAttempts,
      late_join_minutes: input.lateJoinMinutes,
      require_exam_browser: input.requireExamBrowser,
    }))
  );
  if (schedErr) {
    throw new ServiceError(400, "SCHEDULE_SAVE_FAILED", "Gagal menyimpan jadwal ujian.");
  }

  const schoolSchedules = await fetchSchoolSchedules(supabase, actor.schoolId);
  const conflicts = detectScheduleConflicts({
    examId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    assignedClassIds: uniqueClassIds,
    schoolSchedules,
  });

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "exam.scheduled",
    entityType: "exam",
    entityId: examId,
    summary: `Menjadwalkan ujian "${detail.exam.title}" untuk ${uniqueClassIds.length} kelas`,
    metadata: { classCount: uniqueClassIds.length, conflictCount: conflicts.length },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { versionLock: lockedExam.version_lock as number, conflicts };
}

export async function validateExamForReviewService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  versionLock: number,
  ctx: RequestAuditContext
): Promise<{ readiness: ExamReadinessValidation; versionLock: number }> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.write");
  if (!isExamEditable(detail.exam.status)) {
    throw new ServiceError(409, "EXAM_IMMUTABLE", "Ujian tidak dalam status draf.");
  }

  const readiness = validateExamReadiness({
    exam: detail.exam,
    draftQuestions: detail.draftQuestions,
    assignments: detail.assignments,
  });

  if (!readiness.ready) {
    return { readiness, versionLock: detail.exam.version_lock };
  }

  const nextLock = detail.exam.version_lock + 1;
  const { data: updated, error } = await supabase
    .from("exams")
    .update({ status: "READY_FOR_REVIEW", version_lock: nextLock })
    .eq("id", examId)
    .eq("school_id", actor.schoolId)
    .eq("version_lock", versionLock)
    .select("version_lock")
    .maybeSingle();

  if (error || !updated) {
    throw new ServiceError(409, "CONCURRENCY_CONFLICT", "Ujian telah diubah oleh sesi lain.");
  }

  await supabase.from("exam_publication_events").insert({
    school_id: actor.schoolId,
    exam_id: examId,
    event_type: "VALIDATED",
    actor_user_id: actor.userId,
    notes: "Ujian lolos pemeriksaan kelengkapan dan siap diterbitkan.",
  });

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "exam.validated",
    entityType: "exam",
    entityId: examId,
    summary: `Memvalidasi kesiapan ujian "${detail.exam.title}"`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { readiness, versionLock: updated.version_lock as number };
}

export async function publishExamService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown
): Promise<{
  examVersionId: string;
  versionNumber: number;
  totalPoints: number;
  questionCount: number;
  snapshotHash: string;
  versionLock: number;
}> {
  await assertExamAccess(supabase, actor, examId, "exams.publish");

  const parsed = publishExamSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Permintaan publikasi tidak valid."
    );
  }

  const { data, error } = await supabase.rpc("publish_exam_atomic", {
    p_exam_id: examId,
    p_expected_version_lock: parsed.data.versionLock,
    p_notes: parsed.data.notes ?? null,
  });

  if (error || !data) {
    const msg = error?.message ?? "Gagal menerbitkan ujian.";
    const status = msg.includes("CONCURRENCY_CONFLICT") || msg.includes("ALREADY_PUBLISHED")
      ? 409
      : msg.includes("Forbidden")
        ? 403
        : 400;
    throw new ServiceError(status, "PUBLISH_FAILED", msg);
  }

  const res = data as {
    exam_version_id: string;
    version_number: number;
    total_points: number;
    question_count: number;
    snapshot_hash: string;
    version_lock: number;
  };

  return {
    examVersionId: res.exam_version_id,
    versionNumber: res.version_number,
    totalPoints: Number(res.total_points),
    questionCount: res.question_count,
    snapshotHash: res.snapshot_hash,
    versionLock: res.version_lock,
  };
}

export async function startExamRevisionService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown
): Promise<{ versionLock: number }> {
  await assertExamAccess(supabase, actor, examId, "exams.publish");

  const parsed = publishExamSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(400, "VALIDATION_ERROR", "Parameter revisi ujian tidak valid.");
  }

  const { data, error } = await supabase.rpc("start_exam_revision", {
    p_exam_id: examId,
    p_expected_version_lock: parsed.data.versionLock,
    p_notes: parsed.data.notes ?? null,
  });

  if (error || !data) {
    const msg = error?.message ?? "Gagal membuka revisi ujian.";
    throw new ServiceError(msg.includes("CONCURRENCY_CONFLICT") ? 409 : 400, "REVISION_FAILED", msg);
  }

  return { versionLock: (data as { version_lock: number }).version_lock };
}

export async function transitionExamStatusService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ status: ExamStatus; versionLock: number }> {
  const detail = await assertExamAccess(supabase, actor, examId, "exams.publish");

  const parsed = examStatusTransitionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(400, "VALIDATION_ERROR", "Status tujuan tidak valid.");
  }
  const input = parsed.data;

  if (!canTransitionExamStatus(detail.exam.status, input.targetStatus)) {
    throw new ServiceError(
      400,
      "INVALID_LIFECYCLE_TRANSITION",
      `Status tidak dapat diubah dari ${detail.exam.status} ke ${input.targetStatus}.`
    );
  }

  if (input.targetStatus === "DRAFT" && detail.exam.status === "PUBLISHED") {
    const rev = await startExamRevisionService(supabase, actor, examId, {
      versionLock: input.versionLock,
      notes: input.notes,
    });
    return { status: "DRAFT", versionLock: rev.versionLock };
  }

  const nextLock = detail.exam.version_lock + 1;
  const { data: updated, error } = await supabase
    .from("exams")
    .update({ status: input.targetStatus, version_lock: nextLock })
    .eq("id", examId)
    .eq("school_id", actor.schoolId)
    .eq("version_lock", input.versionLock)
    .select("version_lock")
    .maybeSingle();

  if (error || !updated) {
    throw new ServiceError(409, "CONCURRENCY_CONFLICT", "Ujian telah diperbarui oleh sesi lain.");
  }

  const isAdminActor = hasRole(actor.roles, "admin");
  const eventType =
    input.targetStatus === "CLOSED"
      ? isAdminActor
        ? "ADMIN_CLOSED"
        : "CLOSED"
      : input.targetStatus === "ARCHIVED"
        ? isAdminActor
          ? "ADMIN_ARCHIVED"
          : "ARCHIVED"
        : "VALIDATED";

  if (input.targetStatus === "CLOSED" || input.targetStatus === "ARCHIVED") {
    await supabase.from("exam_publication_events").insert({
      school_id: actor.schoolId,
      exam_id: examId,
      exam_version_id: detail.exam.published_version_id,
      event_type: eventType,
      actor_user_id: actor.userId,
      notes: input.notes ?? null,
    });
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action:
      input.targetStatus === "CLOSED"
        ? isAdminActor
          ? "exam.admin_closed"
          : "exam.closed"
        : input.targetStatus === "ARCHIVED"
          ? isAdminActor
            ? "exam.admin_archived"
            : "exam.archived"
          : "exam.updated",
    entityType: "exam",
    entityId: examId,
    summary: `Mengubah status ujian "${detail.exam.title}" menjadi ${input.targetStatus}`,
    metadata: { previousStatus: detail.exam.status, notes: input.notes ?? null },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { status: input.targetStatus, versionLock: updated.version_lock as number };
}

export async function getExamPreviewService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  mode: "student" | "teacher",
  preferPublished = false
): Promise<StudentExamPreviewPayload | TeacherExamReviewPayload> {
  await assertExamAccess(supabase, actor, examId, "exams.read");

  if (mode === "student") {
    const payload = await buildStudentSafeExamPreview(
      supabase,
      actor.schoolId,
      examId,
      preferPublished
    );
    if (!payload) throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
    return payload;
  }

  const payload = await buildTeacherReviewExamPreview(
    supabase,
    actor.schoolId,
    examId,
    preferPublished
  );
  if (!payload) throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  return payload;
}
