import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExamClassAssignmentItem,
  ExamDraftQuestionItem,
  ExamPublicationEventItem,
  ExamRecord,
  ExamScheduleItem,
  ExamStatus,
  ExamVersionSummary,
  QuestionType,
  ResultReleasePolicy,
  ScoringPolicy,
  StudentExamPreviewPayload,
  TeacherExamReviewPayload,
} from "@/domain/exams/phase2-types";
import { mapQuestionRow } from "@/repositories/question-bank-repository";

interface RawExamRow {
  id: string;
  school_id: string;
  subject_id: string;
  academic_year_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  status: ExamStatus;
  duration_minutes: number;
  max_attempts: number;
  passing_score: number | string;
  randomize_questions: boolean;
  randomize_options: boolean;
  starts_at: string | null;
  ends_at: string | null;
  published_version_id: string | null;
  version_lock: number;
  result_release_policy?: ResultReleasePolicy;
  results_released_at?: string | null;
  results_released_by?: string | null;
  allow_student_review?: boolean;
  created_at: string;
  updated_at: string;
  subject?: { code?: string; name?: string } | Array<{ code?: string; name?: string }> | null;
  academic_year?: { name?: string; semester?: string } | Array<{ name?: string; semester?: string }> | null;
  author?: { full_name?: string } | Array<{ full_name?: string }> | null;
  draft_questions?: Array<{
    points_override?: number | string | null;
    question?: { current_version?: { points?: number | string } | Array<{ points?: number | string }> | null } | null;
  }> | null;
  assignments?: Array<{ class_id: string }> | null;
}

function mapExamRow(raw: RawExamRow): ExamRecord {
  const subj = Array.isArray(raw.subject) ? raw.subject[0] : raw.subject;
  const year = Array.isArray(raw.academic_year) ? raw.academic_year[0] : raw.academic_year;
  const author = Array.isArray(raw.author) ? raw.author[0] : raw.author;
  const draftQs = Array.isArray(raw.draft_questions) ? raw.draft_questions : [];

  const totalPoints = draftQs.reduce((sum, item) => {
    const qVer = item.question?.current_version
      ? Array.isArray(item.question.current_version)
        ? item.question.current_version[0]
        : item.question.current_version
      : null;
    const pts = item.points_override ?? qVer?.points ?? 0;
    return sum + Number(pts);
  }, 0);

  return {
    id: raw.id,
    school_id: raw.school_id,
    subject_id: raw.subject_id,
    subject_code: subj?.code,
    subject_name: subj?.name,
    academic_year_id: raw.academic_year_id,
    academic_year_name: year?.name,
    academic_year_semester: year?.semester,
    created_by: raw.created_by ?? null,
    created_by_name: author?.full_name ?? null,
    title: raw.title,
    description: raw.description ?? null,
    instructions: raw.instructions ?? null,
    status: raw.status,
    duration_minutes: raw.duration_minutes,
    max_attempts: raw.max_attempts,
    passing_score: Number(raw.passing_score),
    randomize_questions: Boolean(raw.randomize_questions),
    randomize_options: Boolean(raw.randomize_options),
    starts_at: raw.starts_at ?? null,
    ends_at: raw.ends_at ?? null,
    published_version_id: raw.published_version_id ?? null,
    version_lock: raw.version_lock,
    result_release_policy: raw.result_release_policy ?? "manual",
    results_released_at: raw.results_released_at ?? null,
    results_released_by: raw.results_released_by ?? null,
    allow_student_review: Boolean(raw.allow_student_review ?? false),
    question_count: draftQs.length,
    total_points: totalPoints,
    assigned_class_count: Array.isArray(raw.assignments) ? raw.assignments.length : 0,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export interface ExamListFilter {
  schoolId: string;
  subjectId?: string;
  status?: ExamStatus;
  createdBy?: string;
  classId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function fetchExamsList(
  supabase: SupabaseClient,
  filter: ExamListFilter
): Promise<{ exams: ExamRecord[]; total: number }> {
  const from = Math.max(0, (filter.page - 1) * filter.pageSize);
  const to = from + filter.pageSize - 1;

  let query = supabase
    .from("exams")
    .select(
      `
      *,
      subject:subject_id ( code, name ),
      academic_year:academic_year_id ( name, semester ),
      author:created_by ( full_name ),
      draft_questions:exam_draft_questions (
        points_override,
        question:question_id (
          current_version:current_version_id ( points )
        )
      ),
      assignments:exam_assignments ( class_id )
    `,
      { count: "exact" }
    )
    .eq("school_id", filter.schoolId);

  if (filter.subjectId) query = query.eq("subject_id", filter.subjectId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.createdBy) query = query.eq("created_by", filter.createdBy);
  if (filter.search?.trim()) {
    const clean = filter.search.trim().replace(/[%_]/g, "");
    if (clean) query = query.ilike("title", `%${clean}%`);
  }

  const { data, count, error } = await query
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) {
    throw new Error(`Gagal memuat daftar ujian: ${error.message}`);
  }

  let exams = ((data ?? []) as RawExamRow[]).map(mapExamRow);
  if (filter.classId) {
    const rawList = (data ?? []) as RawExamRow[];
    const matchingIds = new Set(
      rawList
        .filter((r) => (r.assignments ?? []).some((a) => a.class_id === filter.classId))
        .map((r) => r.id)
    );
    exams = exams.filter((e) => matchingIds.has(e.id));
  }

  return {
    exams,
    total: filter.classId ? exams.length : (count ?? exams.length),
  };
}

export async function fetchExamDetail(
  supabase: SupabaseClient,
  schoolId: string,
  examId: string
): Promise<{
  exam: ExamRecord;
  draftQuestions: ExamDraftQuestionItem[];
  assignments: ExamClassAssignmentItem[];
  schedules: ExamScheduleItem[];
  publishedVersions: ExamVersionSummary[];
  publicationEvents: ExamPublicationEventItem[];
} | null> {
  const { data: examRow, error: examErr } = await supabase
    .from("exams")
    .select(
      `
      *,
      subject:subject_id ( code, name ),
      academic_year:academic_year_id ( name, semester ),
      author:created_by ( full_name )
    `
    )
    .eq("id", examId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (examErr) throw new Error(`Gagal memuat detail ujian: ${examErr.message}`);
  if (!examRow) return null;

  const [draftRes, assignRes, schedRes, verRes, eventRes] = await Promise.all([
    supabase
      .from("exam_draft_questions")
      .select(
        `
        id,
        exam_id,
        question_id,
        display_order,
        points_override,
        preserve_order,
        question:question_id (
          id,
          school_id,
          question_bank_id,
          subject_id,
          created_by,
          current_version_id,
          question_type,
          difficulty,
          topic,
          tags,
          status,
          attachment_metadata,
          content_fingerprint,
          created_at,
          updated_at,
          subject:subject_id ( code, name ),
          current_version:current_version_id (
            id,
            question_id,
            version_number,
            stem,
            explanation,
            points,
            scoring_policy,
            rubric_notes,
            preserve_option_order,
            created_by,
            created_at,
            options:question_options ( option_key, option_text, display_order ),
            answer_key:question_answer_keys ( correct_option_keys )
          )
        )
      `
      )
      .eq("exam_id", examId)
      .order("display_order", { ascending: true }),
    supabase
      .from("exam_assignments")
      .select(
        `
        id,
        exam_id,
        class_id,
        class:class_id (
          id,
          name,
          grade_level,
          enrollments:class_enrollments ( status )
        )
      `
      )
      .eq("exam_id", examId),
    supabase
      .from("exam_schedules")
      .select(
        `
        *,
        class:class_id ( name )
      `
      )
      .eq("exam_id", examId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("exam_versions")
      .select(
        `
        *,
        publisher:published_by ( full_name ),
        questions:exam_version_questions ( id )
      `
      )
      .eq("exam_id", examId)
      .order("version_number", { ascending: false }),
    supabase
      .from("exam_publication_events")
      .select(
        `
        *,
        actor:actor_user_id ( full_name )
      `
      )
      .eq("exam_id", examId)
      .order("created_at", { ascending: false }),
  ]);

  if (draftRes.error) throw new Error(`Gagal memuat soal draf ujian: ${draftRes.error.message}`);
  if (assignRes.error) throw new Error(`Gagal memuat penetapan kelas: ${assignRes.error.message}`);
  if (schedRes.error) throw new Error(`Gagal memuat jadwal ujian: ${schedRes.error.message}`);
  if (verRes.error) throw new Error(`Gagal memuat riwayat versi ujian: ${verRes.error.message}`);
  if (eventRes.error) throw new Error(`Gagal memuat log publikasi: ${eventRes.error.message}`);

  const draftQuestions: ExamDraftQuestionItem[] = (draftRes.data ?? [])
    .filter((row) => row.question !== null)
    .map((row) => {
      const qRaw = Array.isArray(row.question) ? row.question[0] : row.question;
      return {
        id: row.id as string,
        exam_id: row.exam_id as string,
        question_id: row.question_id as string,
        display_order: row.display_order as number,
        points_override: row.points_override !== null ? Number(row.points_override) : null,
        preserve_order: Boolean(row.preserve_order),
        question: mapQuestionRow(qRaw as Parameters<typeof mapQuestionRow>[0]),
      };
    });

  const assignments: ExamClassAssignmentItem[] = (assignRes.data ?? []).map((row) => {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    const clsObj = cls as {
      name?: string;
      grade_level?: string;
      enrollments?: Array<{ status?: string }>;
    } | null;
    const activeCount = (clsObj?.enrollments ?? []).filter((e) => e.status === "active").length;
    return {
      id: row.id as string,
      exam_id: row.exam_id as string,
      class_id: row.class_id as string,
      class_name: clsObj?.name ?? "-",
      grade_level: clsObj?.grade_level ?? "-",
      student_count: activeCount,
    };
  });

  const schedules: ExamScheduleItem[] = (schedRes.data ?? []).map((row) => {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    return {
      id: row.id as string,
      exam_id: row.exam_id as string,
      class_id: row.class_id as string,
      class_name: (cls as { name?: string } | null)?.name ?? "-",
      starts_at: row.starts_at as string,
      ends_at: row.ends_at as string,
      duration_minutes: row.duration_minutes as number,
      max_attempts: row.max_attempts as number,
      late_join_minutes: row.late_join_minutes as number,
      require_exam_browser: Boolean(row.require_exam_browser),
    };
  });

  const publishedVersions: ExamVersionSummary[] = (verRes.data ?? []).map((row) => {
    const pubRel = Array.isArray(row.publisher) ? row.publisher[0] : row.publisher;
    return {
      id: row.id as string,
      exam_id: row.exam_id as string,
      version_number: row.version_number as number,
      title: row.title as string,
      duration_minutes: row.duration_minutes as number,
      max_attempts: row.max_attempts as number,
      total_points: Number(row.total_points),
      passing_score: Number(row.passing_score),
      randomize_questions: Boolean(row.randomize_questions),
      randomize_options: Boolean(row.randomize_options),
      starts_at: row.starts_at as string,
      ends_at: row.ends_at as string,
      snapshot_hash: row.snapshot_hash as string,
      published_by: (row.published_by as string | null) ?? null,
      published_by_name: (pubRel as { full_name?: string } | null)?.full_name ?? null,
      published_at: row.published_at as string,
      question_count: Array.isArray(row.questions) ? row.questions.length : 0,
    };
  });

  const publicationEvents: ExamPublicationEventItem[] = (eventRes.data ?? []).map((row) => {
    const actorRel = Array.isArray(row.actor) ? row.actor[0] : row.actor;
    return {
      id: row.id as string,
      exam_id: row.exam_id as string,
      exam_version_id: (row.exam_version_id as string | null) ?? null,
      event_type: row.event_type as ExamPublicationEventItem["event_type"],
      actor_user_id: (row.actor_user_id as string | null) ?? null,
      actor_name: (actorRel as { full_name?: string } | null)?.full_name ?? null,
      notes: (row.notes as string | null) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: row.created_at as string,
    };
  });

  const mappedExam = mapExamRow(examRow as RawExamRow);
  mappedExam.question_count = draftQuestions.length;
  mappedExam.total_points = draftQuestions.reduce(
    (s, dq) => s + Number(dq.points_override ?? dq.question.current_version?.points ?? 0),
    0
  );
  mappedExam.assigned_class_count = assignments.length;

  return {
    exam: mappedExam,
    draftQuestions,
    assignments,
    schedules,
    publishedVersions,
    publicationEvents,
  };
}

export async function fetchSchoolSchedules(
  supabase: SupabaseClient,
  schoolId: string
): Promise<ExamScheduleItem[]> {
  const { data, error } = await supabase
    .from("exam_schedules")
    .select(
      `
      *,
      class:class_id ( name ),
      exam:exam_id (
        title,
        status,
        subject:subject_id ( name )
      )
    `
    )
    .eq("school_id", schoolId)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Gagal memuat jadwal ujian sekolah: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    const exam = Array.isArray(row.exam) ? row.exam[0] : row.exam;
    const subj = exam
      ? Array.isArray((exam as { subject?: unknown }).subject)
        ? ((exam as { subject?: Array<{ name?: string }> }).subject?.[0] ?? null)
        : ((exam as { subject?: { name?: string } | null }).subject ?? null)
      : null;

    return {
      id: row.id as string,
      exam_id: row.exam_id as string,
      exam_title: (exam as { title?: string } | null)?.title,
      exam_status: (exam as { status?: ExamStatus } | null)?.status,
      subject_name: subj?.name,
      class_id: row.class_id as string,
      class_name: (cls as { name?: string } | null)?.name ?? "-",
      starts_at: row.starts_at as string,
      ends_at: row.ends_at as string,
      duration_minutes: row.duration_minutes as number,
      max_attempts: row.max_attempts as number,
      late_join_minutes: row.late_join_minutes as number,
      require_exam_browser: Boolean(row.require_exam_browser),
    };
  });
}

export async function buildStudentSafeExamPreview(
  supabase: SupabaseClient,
  schoolId: string,
  examId: string,
  preferPublished = false
): Promise<StudentExamPreviewPayload | null> {
  const detail = await fetchExamDetail(supabase, schoolId, examId);
  if (!detail) return null;

  const { exam, draftQuestions } = detail;

  if ((preferPublished || exam.status === "PUBLISHED") && exam.published_version_id) {
    // Query ONLY exam_versions and exam_version_questions; NEVER join exam_version_answer_keys
    const [{ data: versionRow }, { data: snapQuestions }] = await Promise.all([
      supabase
        .from("exam_versions")
        .select("id, version_number, title, instructions, duration_minutes, total_points")
        .eq("id", exam.published_version_id)
        .eq("school_id", schoolId)
        .single(),
      supabase
        .from("exam_version_questions")
        .select("id, source_question_id, display_order, question_type, stem, points, options_snapshot")
        .eq("exam_version_id", exam.published_version_id)
        .order("display_order", { ascending: true }),
    ]);

    if (versionRow && snapQuestions) {
      return {
        examId: exam.id,
        source: "published_snapshot",
        versionNumber: versionRow.version_number as number,
        title: versionRow.title as string,
        subjectName: exam.subject_name ?? "-",
        instructions: (versionRow.instructions as string | null) ?? null,
        durationMinutes: versionRow.duration_minutes as number,
        totalQuestions: snapQuestions.length,
        totalPoints: Number(versionRow.total_points),
        questions: snapQuestions.map((sq, idx) => ({
          index: idx + 1,
          questionId: sq.source_question_id as string,
          questionType: sq.question_type as QuestionType,
          stem: sq.stem as string,
          points: Number(sq.points),
          options: Array.isArray(sq.options_snapshot)
            ? (
                sq.options_snapshot as Array<{
                  option_key: string;
                  option_text: string;
                  display_order: number;
                }>
              ).map((o) => ({
                optionKey: o.option_key,
                optionText: o.option_text,
                displayOrder: o.display_order,
              }))
            : [],
        })),
      };
    }
  }

  // Draft preview projection: deliberately strips answer keys, explanations, rubrics
  const validDrafts = draftQuestions.filter((dq) => dq.question.current_version !== null);
  const totalPoints = validDrafts.reduce(
    (s, dq) => s + Number(dq.points_override ?? dq.question.current_version?.points ?? 0),
    0
  );

  return {
    examId: exam.id,
    source: "draft",
    versionNumber: null,
    title: exam.title,
    subjectName: exam.subject_name ?? "-",
    instructions: exam.instructions,
    durationMinutes: exam.duration_minutes,
    totalQuestions: validDrafts.length,
    totalPoints,
    questions: validDrafts.map((dq, idx) => ({
      index: idx + 1,
      questionId: dq.question_id,
      questionType: dq.question.question_type,
      stem: dq.question.current_version!.stem,
      points: Number(dq.points_override ?? dq.question.current_version!.points),
      options: dq.question.current_version!.options.map((o) => ({
        optionKey: o.optionKey,
        optionText: o.optionText,
        displayOrder: o.displayOrder,
      })),
    })),
  };
}

export async function buildTeacherReviewExamPreview(
  supabase: SupabaseClient,
  schoolId: string,
  examId: string,
  preferPublished = false
): Promise<TeacherExamReviewPayload | null> {
  const detail = await fetchExamDetail(supabase, schoolId, examId);
  if (!detail) return null;

  const { exam, draftQuestions } = detail;

  if ((preferPublished || exam.status === "PUBLISHED") && exam.published_version_id) {
    const [{ data: versionRow }, { data: snapQuestions }] = await Promise.all([
      supabase
        .from("exam_versions")
        .select(
          "id, version_number, title, instructions, duration_minutes, passing_score, total_points"
        )
        .eq("id", exam.published_version_id)
        .eq("school_id", schoolId)
        .single(),
      supabase
        .from("exam_version_questions")
        .select(
          `
          id,
          source_question_id,
          display_order,
          question_type,
          stem,
          explanation,
          points,
          scoring_policy,
          rubric_notes,
          options_snapshot,
          answer_key:exam_version_answer_keys ( correct_option_keys )
        `
        )
        .eq("exam_version_id", exam.published_version_id)
        .order("display_order", { ascending: true }),
    ]);

    if (versionRow && snapQuestions) {
      return {
        examId: exam.id,
        source: "published_snapshot",
        versionNumber: versionRow.version_number as number,
        title: versionRow.title as string,
        subjectName: exam.subject_name ?? "-",
        instructions: (versionRow.instructions as string | null) ?? null,
        durationMinutes: versionRow.duration_minutes as number,
        passingScore: Number(versionRow.passing_score),
        totalQuestions: snapQuestions.length,
        totalPoints: Number(versionRow.total_points),
        questions: snapQuestions.map((sq, idx) => {
          const akRel = Array.isArray(sq.answer_key) ? sq.answer_key[0] : sq.answer_key;
          return {
            index: idx + 1,
            questionId: sq.source_question_id as string,
            questionType: sq.question_type as QuestionType,
            stem: sq.stem as string,
            points: Number(sq.points),
            options: Array.isArray(sq.options_snapshot)
              ? (
                  sq.options_snapshot as Array<{
                    option_key: string;
                    option_text: string;
                    display_order: number;
                  }>
                ).map((o) => ({
                  optionKey: o.option_key,
                  optionText: o.option_text,
                  displayOrder: o.display_order,
                }))
              : [],
            correctOptionKeys:
              (akRel as { correct_option_keys?: string[] } | null)?.correct_option_keys ?? [],
            explanation: (sq.explanation as string | null) ?? null,
            scoringPolicy: sq.scoring_policy as ScoringPolicy,
            rubricNotes: (sq.rubric_notes as string | null) ?? null,
          };
        }),
      };
    }
  }

  const validDrafts = draftQuestions.filter((dq) => dq.question.current_version !== null);
  const totalPoints = validDrafts.reduce(
    (s, dq) => s + Number(dq.points_override ?? dq.question.current_version?.points ?? 0),
    0
  );

  return {
    examId: exam.id,
    source: "draft",
    versionNumber: null,
    title: exam.title,
    subjectName: exam.subject_name ?? "-",
    instructions: exam.instructions,
    durationMinutes: exam.duration_minutes,
    passingScore: exam.passing_score,
    totalQuestions: validDrafts.length,
    totalPoints,
    questions: validDrafts.map((dq, idx) => {
      const ver = dq.question.current_version!;
      return {
        index: idx + 1,
        questionId: dq.question_id,
        questionType: dq.question.question_type,
        stem: ver.stem,
        points: Number(dq.points_override ?? ver.points),
        options: ver.options,
        correctOptionKeys: ver.correct_option_keys,
        explanation: ver.explanation,
        scoringPolicy: ver.scoring_policy,
        rubricNotes: ver.rubric_notes,
      };
    }),
  };
}
