import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type {
  QuestionDifficulty,
  QuestionRecord,
  QuestionStatus,
  QuestionType,
  QuestionVersionRecord,
} from "@/domain/exams/phase2-types";
import {
  normalizeQuestionFingerprint,
  validateQuestionDomainRules,
} from "@/domain/exams/question-rules";
import {
  parseQuestionImportFile,
  type ImportParseResult,
} from "@/domain/exams/import-parser";
import { sanitizePlainQuestionText } from "@/lib/question-content";
import { hasPermission, hasRole } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import {
  ensureDefaultQuestionBank,
  fetchExistingFingerprints,
  fetchPaginatedQuestions,
  fetchQuestionDetail,
} from "@/repositories/question-bank-repository";
import { upsertQuestionSchema } from "@/schemas/exams";
import { ServiceError } from "@/services/errors";
import type { RequestAuditContext } from "@/services/admin-service";

export async function getAuthorizedSubjectIdsForActor(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<Array<{ id: string; code: string; name: string }>> {
  if (hasRole(actor.roles, "admin")) {
    const { data, error } = await supabase
      .from("subjects")
      .select("id, code, name")
      .eq("school_id", actor.schoolId)
      .eq("is_active", true)
      .order("code", { ascending: true });

    if (error) throw new Error(`Gagal memuat mata pelajaran: ${error.message}`);
    return (data ?? []) as Array<{ id: string; code: string; name: string }>;
  }

  if (!hasRole(actor.roles, "teacher")) {
    return [];
  }

  const { data: teacherRow } = await supabase
    .from("teachers")
    .select("id")
    .eq("user_id", actor.userId)
    .eq("school_id", actor.schoolId)
    .eq("is_active", true)
    .maybeSingle();

  if (!teacherRow) return [];

  const { data: assignRows, error } = await supabase
    .from("teacher_assignments")
    .select("subject:subject_id ( id, code, name, is_active )")
    .eq("teacher_id", teacherRow.id)
    .eq("school_id", actor.schoolId)
    .eq("is_active", true);

  if (error) throw new Error(`Gagal memuat mata pelajaran diampu: ${error.message}`);

  const subjectMap = new Map<string, { id: string; code: string; name: string }>();
  for (const row of assignRows ?? []) {
    const subj = Array.isArray(row.subject) ? row.subject[0] : row.subject;
    if (subj && (subj as { is_active?: boolean }).is_active !== false) {
      const s = subj as { id: string; code: string; name: string };
      subjectMap.set(s.id, { id: s.id, code: s.code, name: s.name });
    }
  }

  return Array.from(subjectMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

async function assertCanAccessSubject(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  subjectId: string,
  requiredPermission: "questions.read" | "questions.write"
): Promise<void> {
  if (!actor.isActive || !hasPermission(actor.roles, requiredPermission)) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin mengakses bank soal.");
  }

  const authorizedSubjects = await getAuthorizedSubjectIdsForActor(supabase, actor);
  if (!authorizedSubjects.some((s) => s.id === subjectId)) {
    throw new ServiceError(
      403,
      "SUBJECT_FORBIDDEN",
      "Anda hanya dapat mengelola bank soal untuk mata pelajaran yang ditugaskan kepada Anda."
    );
  }
}

export async function listQuestionsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  filters: {
    subjectId?: string;
    questionType?: QuestionType;
    difficulty?: QuestionDifficulty;
    status?: QuestionStatus | "all_non_archived";
    search?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{
  questions: QuestionRecord[];
  total: number;
  page: number;
  pageSize: number;
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
}> {
  if (!actor.isActive || !hasPermission(actor.roles, "questions.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses bank soal ditolak.");
  }

  const authorizedSubjects = await getAuthorizedSubjectIdsForActor(supabase, actor);
  if (filters.subjectId && !authorizedSubjects.some((s) => s.id === filters.subjectId)) {
    throw new ServiceError(403, "SUBJECT_FORBIDDEN", "Mata pelajaran di luar kewenangan Anda.");
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, filters.pageSize ?? 20));

  const { questions, total } = await fetchPaginatedQuestions(supabase, {
    schoolId: actor.schoolId,
    subjectId: filters.subjectId,
    questionType: filters.questionType,
    difficulty: filters.difficulty,
    status: filters.status ?? "all_non_archived",
    search: filters.search,
    tag: filters.tag,
    page,
    pageSize,
  });

  return { questions, total, page, pageSize, authorizedSubjects };
}

export async function getQuestionDetailService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  questionId: string
): Promise<{ question: QuestionRecord; versions: QuestionVersionRecord[] }> {
  if (!actor.isActive || !hasPermission(actor.roles, "questions.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses detail soal ditolak.");
  }

  const detail = await fetchQuestionDetail(supabase, actor.schoolId, questionId);
  if (!detail) {
    throw new ServiceError(404, "QUESTION_NOT_FOUND", "Soal tidak ditemukan.");
  }

  await assertCanAccessSubject(supabase, actor, detail.question.subject_id, "questions.read");
  return detail;
}

export async function createQuestionService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown
): Promise<{ questionId: string; versionId: string; versionNumber: number }> {
  if (!actor.isActive || !hasPermission(actor.roles, "questions.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin membuat atau mengubah bank soal.");
  }

  const parsed = upsertQuestionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data soal tidak valid."
    );
  }
  const input = parsed.data;

  await assertCanAccessSubject(supabase, actor, input.subjectId, "questions.write");

  const stemClean = sanitizePlainQuestionText(input.stem);
  const domainCheck = validateQuestionDomainRules({
    questionType: input.questionType,
    stem: stemClean,
    points: input.points,
    scoringPolicy: input.scoringPolicy,
    options: input.options.map((o) => ({
      optionKey: sanitizePlainQuestionText(o.optionKey),
      optionText: sanitizePlainQuestionText(o.optionText),
      displayOrder: o.displayOrder,
    })),
    correctOptionKeys: input.correctOptionKeys,
  });

  if (!domainCheck.valid) {
    throw new ServiceError(400, "QUESTION_RULE_VIOLATION", domainCheck.errors.join(" "));
  }

  const bank = input.questionBankId
    ? { id: input.questionBankId }
    : await ensureDefaultQuestionBank(supabase, actor.schoolId, input.subjectId, actor.userId);

  const fingerprint = normalizeQuestionFingerprint(
    input.questionType,
    stemClean,
    domainCheck.normalizedOptions
  );

  const { data, error } = await supabase.rpc("create_question_with_version", {
    p_question_bank_id: bank.id,
    p_subject_id: input.subjectId,
    p_question_type: input.questionType,
    p_difficulty: input.difficulty,
    p_topic: input.topic ? sanitizePlainQuestionText(input.topic) : null,
    p_tags: input.tags.map(sanitizePlainQuestionText).filter(Boolean),
    p_status: input.status,
    p_attachment_metadata: [],
    p_content_fingerprint: fingerprint,
    p_stem: stemClean,
    p_explanation: input.explanation ? sanitizePlainQuestionText(input.explanation) : null,
    p_points: input.points,
    p_scoring_policy: domainCheck.normalizedScoringPolicy,
    p_rubric_notes: input.rubricNotes ? sanitizePlainQuestionText(input.rubricNotes) : null,
    p_preserve_option_order: input.preserveOptionOrder,
    p_options: domainCheck.normalizedOptions,
    p_correct_option_keys: domainCheck.normalizedCorrectKeys,
  });

  if (error || !data) {
    throw new ServiceError(
      400,
      "QUESTION_CREATE_FAILED",
      error?.message ?? "Gagal menyimpan soal ke bank soal."
    );
  }

  const res = data as { question_id: string; version_id: string; version_number: number };
  return {
    questionId: res.question_id,
    versionId: res.version_id,
    versionNumber: res.version_number,
  };
}

export async function updateQuestionService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  questionId: string,
  rawInput: unknown
): Promise<{ questionId: string; versionId: string; versionNumber: number }> {
  const existing = await getQuestionDetailService(supabase, actor, questionId);
  await assertCanAccessSubject(supabase, actor, existing.question.subject_id, "questions.write");

  const parsed = upsertQuestionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan soal tidak valid."
    );
  }
  const input = parsed.data;

  if (input.questionType !== existing.question.question_type) {
    throw new ServiceError(
      400,
      "TYPE_CHANGE_FORBIDDEN",
      "Tipe soal tidak dapat diubah setelah dibuat. Gunakan fitur Duplikasi Soal untuk tipe berbeda."
    );
  }

  const stemClean = sanitizePlainQuestionText(input.stem);
  const domainCheck = validateQuestionDomainRules({
    questionType: existing.question.question_type,
    stem: stemClean,
    points: input.points,
    scoringPolicy: input.scoringPolicy,
    options: input.options.map((o) => ({
      optionKey: sanitizePlainQuestionText(o.optionKey),
      optionText: sanitizePlainQuestionText(o.optionText),
      displayOrder: o.displayOrder,
    })),
    correctOptionKeys: input.correctOptionKeys,
  });

  if (!domainCheck.valid) {
    throw new ServiceError(400, "QUESTION_RULE_VIOLATION", domainCheck.errors.join(" "));
  }

  const fingerprint = normalizeQuestionFingerprint(
    existing.question.question_type,
    stemClean,
    domainCheck.normalizedOptions
  );

  const { data, error } = await supabase.rpc("update_question_new_version", {
    p_question_id: questionId,
    p_difficulty: input.difficulty,
    p_topic: input.topic ? sanitizePlainQuestionText(input.topic) : null,
    p_tags: input.tags.map(sanitizePlainQuestionText).filter(Boolean),
    p_status: input.status,
    p_attachment_metadata: existing.question.attachment_metadata ?? [],
    p_content_fingerprint: fingerprint,
    p_stem: stemClean,
    p_explanation: input.explanation ? sanitizePlainQuestionText(input.explanation) : null,
    p_points: input.points,
    p_scoring_policy: domainCheck.normalizedScoringPolicy,
    p_rubric_notes: input.rubricNotes ? sanitizePlainQuestionText(input.rubricNotes) : null,
    p_preserve_option_order: input.preserveOptionOrder,
    p_options: domainCheck.normalizedOptions,
    p_correct_option_keys: domainCheck.normalizedCorrectKeys,
  });

  if (error || !data) {
    throw new ServiceError(
      400,
      "QUESTION_UPDATE_FAILED",
      error?.message ?? "Gagal menyimpan versi baru soal."
    );
  }

  const res = data as { question_id: string; version_id: string; version_number: number };
  return {
    questionId: res.question_id,
    versionId: res.version_id,
    versionNumber: res.version_number,
  };
}

export async function duplicateQuestionService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  questionId: string,
  ctx: RequestAuditContext
): Promise<{ questionId: string; versionId: string; versionNumber: number }> {
  const { question } = await getQuestionDetailService(supabase, actor, questionId);
  await assertCanAccessSubject(supabase, actor, question.subject_id, "questions.write");

  const ver = question.current_version;
  if (!ver) {
    throw new ServiceError(400, "QUESTION_INCOMPLETE", "Soal tidak memiliki versi aktif untuk diduplikasi.");
  }

  const created = await createQuestionService(supabase, actor, {
    questionBankId: question.question_bank_id,
    subjectId: question.subject_id,
    questionType: question.question_type,
    difficulty: question.difficulty,
    topic: question.topic,
    tags: question.tags,
    status: "draft",
    stem: `${ver.stem} (Salinan)`,
    explanation: ver.explanation,
    points: ver.points,
    scoringPolicy: ver.scoring_policy,
    rubricNotes: ver.rubric_notes,
    preserveOptionOrder: ver.preserve_option_order,
    options: ver.options,
    correctOptionKeys: ver.correct_option_keys,
  });

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "question.duplicated",
    entityType: "question",
    entityId: created.questionId,
    summary: `Menduplikasi soal dari ${questionId}`,
    metadata: { sourceQuestionId: questionId, newQuestionId: created.questionId },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return created;
}

export async function archiveQuestionService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  questionId: string,
  ctx: RequestAuditContext
): Promise<void> {
  const { question } = await getQuestionDetailService(supabase, actor, questionId);
  await assertCanAccessSubject(supabase, actor, question.subject_id, "questions.write");

  const { error } = await supabase
    .from("questions")
    .update({ status: "archived" })
    .eq("id", questionId)
    .eq("school_id", actor.schoolId);

  if (error) {
    throw new ServiceError(400, "QUESTION_ARCHIVE_FAILED", "Gagal mengarsipkan soal.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "question.archived",
    entityType: "question",
    entityId: questionId,
    summary: "Mengarsipkan soal pada bank soal",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function previewQuestionImportService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  params: { subjectId: string; fileName: string; buffer: ArrayBuffer }
): Promise<ImportParseResult> {
  await assertCanAccessSubject(supabase, actor, params.subjectId, "questions.write");
  const existingFingerprints = await fetchExistingFingerprints(
    supabase,
    actor.schoolId,
    params.subjectId
  );

  try {
    return await parseQuestionImportFile({
      fileName: params.fileName,
      buffer: params.buffer,
      existingFingerprints,
    });
  } catch (err) {
    throw new ServiceError(
      400,
      "IMPORT_PARSE_ERROR",
      err instanceof Error ? err.message : "Berkas impor tidak dapat diproses."
    );
  }
}

export async function commitQuestionImportService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  params: {
    subjectId: string;
    fileName: string;
    buffer: ArrayBuffer;
    allowSkipRejected: boolean;
  }
): Promise<{
  batchId: string;
  importedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  rejectedRows: ImportParseResult["rejectedRows"];
}> {
  const preview = await previewQuestionImportService(supabase, actor, params);

  if (!params.allowSkipRejected && preview.rejectedRows.length > 0) {
    throw new ServiceError(
      400,
      "IMPORT_HAS_REJECTED_ROWS",
      `Terdapat ${preview.rejectedRows.length} baris yang gagal validasi atau duplikat. Perbaiki berkas atau pilih lewati baris bermasalah.`
    );
  }

  if (preview.validRows.length === 0) {
    throw new ServiceError(
      400,
      "IMPORT_NO_VALID_ROWS",
      "Tidak ada baris soal valid yang siap diimpor."
    );
  }

  const bank = await ensureDefaultQuestionBank(supabase, actor.schoolId, params.subjectId, actor.userId);

  const { data, error } = await supabase.rpc("import_questions_atomic", {
    p_question_bank_id: bank.id,
    p_file_name: params.fileName.slice(0, 180),
    p_file_format: preview.fileFormat,
    p_total_rows: preview.totalRows,
    p_rejected_count: preview.rejectedRows.length,
    p_rows: preview.validRows,
    p_report_summary: {
      duplicateCount: preview.duplicateCount,
      rejectedSample: preview.rejectedRows.slice(0, 25),
    },
  });

  if (error || !data) {
    throw new ServiceError(
      400,
      "IMPORT_COMMIT_FAILED",
      error?.message ?? "Gagal menyimpan impor soal secara atomik."
    );
  }

  const res = data as { batch_id: string; imported_count: number };
  return {
    batchId: res.batch_id,
    importedCount: res.imported_count,
    rejectedCount: preview.rejectedRows.length,
    duplicateCount: preview.duplicateCount,
    rejectedRows: preview.rejectedRows,
  };
}
