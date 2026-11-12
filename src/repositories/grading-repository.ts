import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttemptEventSource,
  AttemptLifecycleStatus,
  GradingStatus,
  ObservedMonitoringEventType,
  ResultReleaseStatus,
} from "@/domain/exams/contracts";
import { evaluateObjectiveQuestionResponse } from "@/domain/exams/grading";
import type {
  ExamStatus,
  QuestionType,
  ResultReleasePolicy,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";
import type {
  StoredCanonicalAnswerPayload,
  TeacherAttemptDetailPayload,
  TeacherAttemptQuestionInspection,
  TeacherGradingAttemptSummary,
} from "@/domain/exams/phase3-types";

export interface TeacherGradingExamSummaryItem {
  examId: string;
  title: string;
  subjectName: string;
  subjectCode: string;
  examStatus: ExamStatus;
  resultReleasePolicy: ResultReleasePolicy;
  resultsReleasedAt: string | null;
  totalAttempts: number;
  inProgressCount: number;
  submittedCount: number;
  pendingEssayAttemptsCount: number;
  gradedCount: number;
  releasedCount: number;
}

export async function fetchTeacherGradingOverview(
  supabase: SupabaseClient,
  schoolId: string,
  authorizedSubjectIds: string[] | null
): Promise<TeacherGradingExamSummaryItem[]> {
  let query = supabase
    .from("exams")
    .select(
      `
      id,
      title,
      status,
      subject_id,
      result_release_policy,
      results_released_at,
      subject:subject_id ( code, name )
    `
    )
    .eq("school_id", schoolId)
    .in("status", ["PUBLISHED", "CLOSED"])
    .order("updated_at", { ascending: false });

  if (authorizedSubjectIds !== null) {
    if (authorizedSubjectIds.length === 0) return [];
    query = query.in("subject_id", authorizedSubjectIds);
  }

  const { data: exams, error: exErr } = await query;
  if (exErr) throw new Error(`Gagal memuat ringkasan penilaian ujian: ${exErr.message}`);
  if (!exams || exams.length === 0) return [];

  const examIds = exams.map((e) => e.id as string);
  const [attemptsRes, gradesRes] = await Promise.all([
    supabase
      .from("exam_attempts")
      .select("id, exam_id, status")
      .eq("school_id", schoolId)
      .in("exam_id", examIds),
    supabase
      .from("exam_grades")
      .select("exam_id, grading_status, release_status")
      .eq("school_id", schoolId)
      .in("exam_id", examIds),
  ]);

  if (attemptsRes.error) throw new Error(`Gagal memuat sesi ujian: ${attemptsRes.error.message}`);
  if (gradesRes.error) throw new Error(`Gagal memuat status nilai: ${gradesRes.error.message}`);

  return exams.map((exam) => {
    const eid = exam.id as string;
    const exAttempts = (attemptsRes.data ?? []).filter((a) => a.exam_id === eid);
    const exGrades = (gradesRes.data ?? []).filter((g) => g.exam_id === eid);
    const subj = Array.isArray(exam.subject) ? exam.subject[0] : exam.subject;

    return {
      examId: eid,
      title: exam.title as string,
      subjectName: (subj as { name?: string } | null)?.name ?? "-",
      subjectCode: (subj as { code?: string } | null)?.code ?? "-",
      examStatus: exam.status as ExamStatus,
      resultReleasePolicy: (exam.result_release_policy as ResultReleasePolicy) ?? "manual",
      resultsReleasedAt: (exam.results_released_at as string | null) ?? null,
      totalAttempts: exAttempts.length,
      inProgressCount: exAttempts.filter(
        (a) => a.status === "IN_PROGRESS" || a.status === "SUBMITTING"
      ).length,
      submittedCount: exAttempts.filter(
        (a) => a.status === "SUBMITTED" || a.status === "EXPIRED"
      ).length,
      pendingEssayAttemptsCount: exGrades.filter(
        (g) => g.grading_status === "PENDING_MANUAL_REVIEW"
      ).length,
      gradedCount: exGrades.filter(
        (g) => g.grading_status === "GRADED" || g.grading_status === "ADJUSTED"
      ).length,
      releasedCount: exGrades.filter((g) => g.release_status === "RELEASED").length,
    };
  });
}

export async function fetchExamAttemptsForGrading(
  supabase: SupabaseClient,
  schoolId: string,
  examId: string
): Promise<TeacherGradingAttemptSummary[]> {
  // Converge any active expired attempts for this exam on staff access
  const { data: openAttempts } = await supabase
    .from("exam_attempts")
    .select("id, deadline_at_utc")
    .eq("school_id", schoolId)
    .eq("exam_id", examId)
    .in("status", ["IN_PROGRESS", "SUBMITTING"]);

  const nowMs = Date.now();
  for (const row of openAttempts ?? []) {
    if (Date.parse(row.deadline_at_utc as string) < nowMs) {
      await supabase.rpc("finalize_expired_attempt_on_access", {
        p_attempt_id: row.id as string,
      });
    }
  }

  const { data: attempts, error } = await supabase
    .from("exam_attempts")
    .select(
      `
      id,
      exam_id,
      student_id,
      attempt_number,
      status,
      started_at_utc,
      deadline_at_utc,
      submitted_at_utc,
      student:student_id (
        id,
        user_id,
        nis,
        profile:user_id ( full_name )
      ),
      class:class_id ( name ),
      submission_receipts ( receipt_code, answered_count, total_questions ),
      exam_grades (
        grading_status,
        release_status,
        objective_score,
        manual_score,
        adjustment_delta,
        total_score,
        max_score,
        percentage_score,
        passed,
        pending_manual_count
      )
    `
    )
    .eq("school_id", schoolId)
    .eq("exam_id", examId)
    .order("started_at_utc", { ascending: false });

  if (error) throw new Error(`Gagal memuat daftar sesi peserta: ${error.message}`);

  return (attempts ?? []).map((row) => {
    const stu = Array.isArray(row.student) ? row.student[0] : row.student;
    const prof = stu && Array.isArray((stu as { profile?: unknown }).profile)
      ? ((stu as { profile: Array<{ full_name?: string }> }).profile[0])
      : (stu as { profile?: { full_name?: string } } | null)?.profile;
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    const rec = Array.isArray(row.submission_receipts)
      ? row.submission_receipts[0]
      : row.submission_receipts;
    const gr = Array.isArray(row.exam_grades) ? row.exam_grades[0] : row.exam_grades;

    return {
      attemptId: row.id as string,
      examId: row.exam_id as string,
      studentId: row.student_id as string,
      studentUserId: (stu as { user_id?: string } | null)?.user_id ?? "",
      studentName: prof?.full_name ?? "Siswa",
      studentNis: (stu as { nis?: string | null } | null)?.nis ?? null,
      className: (cls as { name?: string } | null)?.name ?? "-",
      attemptNumber: Number(row.attempt_number),
      status: row.status as AttemptLifecycleStatus,
      startedAtUtc: row.started_at_utc as string,
      deadlineAtUtc: row.deadline_at_utc as string,
      submittedAtUtc: (row.submitted_at_utc as string | null) ?? null,
      receiptCode: (rec as { receipt_code?: string } | null)?.receipt_code ?? null,
      answeredCount: Number((rec as { answered_count?: number } | null)?.answered_count ?? 0),
      totalQuestions: Number((rec as { total_questions?: number } | null)?.total_questions ?? 0),
      gradingStatus:
        ((gr as { grading_status?: GradingStatus } | null)?.grading_status) ?? null,
      releaseStatus:
        ((gr as { release_status?: ResultReleaseStatus } | null)?.release_status) ??
        "UNRELEASED",
      objectiveScore: gr ? Number((gr as { objective_score: number | string }).objective_score) : null,
      manualScore: gr ? Number((gr as { manual_score: number | string }).manual_score) : null,
      adjustmentDelta: gr ? Number((gr as { adjustment_delta: number | string }).adjustment_delta) : null,
      totalScore: gr ? Number((gr as { total_score: number | string }).total_score) : null,
      maxScore: gr ? Number((gr as { max_score: number | string }).max_score) : null,
      percentageScore: gr ? Number((gr as { percentage_score: number | string }).percentage_score) : null,
      passed: gr ? Boolean((gr as { passed: boolean }).passed) : null,
      pendingEssayCount: gr
        ? Number((gr as { pending_manual_count: number }).pending_manual_count ?? 0)
        : 0,
    };
  });
}

export async function fetchTeacherAttemptDetail(
  supabase: SupabaseClient,
  schoolId: string,
  attemptId: string
): Promise<TeacherAttemptDetailPayload | null> {
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
      attempt_number,
      status,
      started_at_utc,
      deadline_at_utc,
      submitted_at_utc,
      student:student_id (
        id,
        user_id,
        nis,
        profile:user_id ( full_name )
      ),
      class:class_id ( name ),
      exam:exam_id (
        title,
        passing_score,
        subject:subject_id ( name )
      ),
      exam_version:exam_version_id ( passing_score ),
      submission_receipts ( receipt_code, answered_count, total_questions ),
      exam_grades (*)
    `
    )
    .eq("id", attemptId)
    .eq("school_id", schoolId)
    .maybeSingle();

  if (attErr) throw new Error(`Gagal memuat detail sesi peserta: ${attErr.message}`);
  if (!attemptRow) return null;

  const [qaRes, evqRes, ansRes, manualRes, adjRes, eventsRes] = await Promise.all([
    supabase
      .from("attempt_question_assignments")
      .select(
        "id, exam_version_question_id, display_index, question_type, stem_snapshot, points_snapshot, option_order_map, options_snapshot"
      )
      .eq("attempt_id", attemptId)
      .order("display_index", { ascending: true }),
    supabase
      .from("exam_version_questions")
      .select(
        `
        id,
        question_type,
        scoring_policy,
        rubric_notes,
        explanation,
        points,
        answer_key:exam_version_answer_keys ( correct_option_keys )
      `
      )
      .eq("exam_version_id", attemptRow.exam_version_id as string),
    supabase
      .from("student_answers")
      .select("exam_version_question_id, response_payload")
      .eq("attempt_id", attemptId),
    supabase
      .from("manual_grading_entries")
      .select(
        `
        exam_version_question_id,
        assigned_score,
        feedback,
        graded_at_utc,
        grader:grader_user_id ( full_name )
      `
      )
      .eq("attempt_id", attemptId),
    supabase
      .from("grade_adjustments")
      .select(
        `
        id,
        previous_total_score,
        new_total_score,
        adjustment_delta,
        reason,
        created_at_utc,
        adjuster:adjusted_by ( full_name )
      `
      )
      .eq("attempt_id", attemptId)
      .order("created_at_utc", { ascending: false }),
    supabase
      .from("attempt_events")
      .select("id, event_source, event_type, metadata, created_at_utc")
      .eq("attempt_id", attemptId)
      .order("created_at_utc", { ascending: false })
      .limit(100),
  ]);

  const evqMap = new Map<
    string,
    {
      scoringPolicy: ScoringPolicy;
      rubricNotes: string | null;
      explanation: string | null;
      correctOptionKeys: string[];
    }
  >();

  for (const row of evqRes.data ?? []) {
    const keyJoin = Array.isArray(row.answer_key) ? row.answer_key[0] : row.answer_key;
    evqMap.set(row.id as string, {
      scoringPolicy: row.scoring_policy as ScoringPolicy,
      rubricNotes: (row.rubric_notes as string | null) ?? null,
      explanation: (row.explanation as string | null) ?? null,
      correctOptionKeys:
        ((keyJoin as { correct_option_keys?: string[] } | null)?.correct_option_keys) ?? [],
    });
  }

  const ansMap = new Map<string, StoredCanonicalAnswerPayload>();
  for (const row of ansRes.data ?? []) {
    ansMap.set(
      row.exam_version_question_id as string,
      (row.response_payload ?? {}) as StoredCanonicalAnswerPayload
    );
  }

  const manualMap = new Map<
    string,
    {
      assignedScore: number;
      feedback: string | null;
      graderName: string | null;
      gradedAtUtc: string;
    }
  >();
  for (const row of manualRes.data ?? []) {
    const graderJoin = Array.isArray(row.grader) ? row.grader[0] : row.grader;
    manualMap.set(row.exam_version_question_id as string, {
      assignedScore: Number(row.assigned_score),
      feedback: (row.feedback as string | null) ?? null,
      graderName: (graderJoin as { full_name?: string } | null)?.full_name ?? null,
      gradedAtUtc: row.graded_at_utc as string,
    });
  }

  const questions: TeacherAttemptQuestionInspection[] = (qaRes.data ?? []).map((qa) => {
    const evqId = qa.exam_version_question_id as string;
    const evqMeta = evqMap.get(evqId);
    const qType = qa.question_type as QuestionType;
    const maxPts = Number(qa.points_snapshot);
    const ans = ansMap.get(evqId) ?? null;
    const manual = manualMap.get(evqId) ?? null;
    const optionMap = (qa.option_order_map ?? {}) as Record<string, string>;
    const optSnapshot = (qa.options_snapshot ?? []) as Array<{
      optionKey: string;
      optionText: string;
    }>;
    const correctKeys = evqMeta?.correctOptionKeys ?? [];

    const evalObj = evaluateObjectiveQuestionResponse({
      questionType: qType,
      scoringPolicy: evqMeta?.scoringPolicy ?? "exact_match",
      maxPoints: maxPts,
      correctOptionKeys: correctKeys,
      response: ans,
    });

    const selectedCanonicalSet = new Set<string>();
    if (ans?.canonicalOptionKey) selectedCanonicalSet.add(ans.canonicalOptionKey);
    if (ans?.selectedOptionKey && optionMap[ans.selectedOptionKey]) {
      selectedCanonicalSet.add(optionMap[ans.selectedOptionKey]!);
    }
    for (const k of ans?.canonicalOptionKeys ?? []) selectedCanonicalSet.add(k);
    for (const dk of ans?.selectedOptionKeys ?? []) {
      if (optionMap[dk]) selectedCanonicalSet.add(optionMap[dk]!);
    }

    const correctSet = new Set(correctKeys);

    return {
      attemptQuestionId: qa.id as string,
      examVersionQuestionId: evqId,
      displayIndex: Number(qa.display_index),
      questionType: qType,
      scoringPolicy: evqMeta?.scoringPolicy ?? "exact_match",
      stem: qa.stem_snapshot as string,
      maxPoints: maxPts,
      rubricNotes: evqMeta?.rubricNotes ?? null,
      explanation: evqMeta?.explanation ?? null,
      options: optSnapshot.map((opt) => {
        const canonical = optionMap[opt.optionKey] ?? opt.optionKey;
        return {
          displayKey: opt.optionKey,
          canonicalKey: canonical,
          optionText: opt.optionText,
          isCorrect: correctSet.has(canonical),
          wasSelected: selectedCanonicalSet.has(canonical),
        };
      }),
      studentAnswer: ans,
      isObjectiveCorrect: evalObj.requiresManualGrading ? null : evalObj.isCorrect,
      awardedPoints: evalObj.requiresManualGrading
        ? (manual?.assignedScore ?? 0)
        : evalObj.awardedPoints,
      manualEntry: manual,
    };
  });

  const stu = Array.isArray(attemptRow.student) ? attemptRow.student[0] : attemptRow.student;
  const prof = stu && Array.isArray((stu as { profile?: unknown }).profile)
    ? ((stu as { profile: Array<{ full_name?: string }> }).profile[0])
    : (stu as { profile?: { full_name?: string } } | null)?.profile;
  const cls = Array.isArray(attemptRow.class) ? attemptRow.class[0] : attemptRow.class;
  const examJoin = Array.isArray(attemptRow.exam) ? attemptRow.exam[0] : attemptRow.exam;
  const subjJoin = examJoin && Array.isArray((examJoin as { subject?: unknown }).subject)
    ? ((examJoin as { subject: Array<{ name?: string }> }).subject[0])
    : (examJoin as { subject?: { name?: string } } | null)?.subject;
  const verJoin = Array.isArray(attemptRow.exam_version)
    ? attemptRow.exam_version[0]
    : attemptRow.exam_version;
  const rec = Array.isArray(attemptRow.submission_receipts)
    ? attemptRow.submission_receipts[0]
    : attemptRow.submission_receipts;
  const gr = Array.isArray(attemptRow.exam_grades)
    ? attemptRow.exam_grades[0]
    : attemptRow.exam_grades;

  const summary: TeacherGradingAttemptSummary = {
    attemptId: attemptRow.id as string,
    examId: attemptRow.exam_id as string,
    studentId: attemptRow.student_id as string,
    studentUserId: (stu as { user_id?: string } | null)?.user_id ?? "",
    studentName: prof?.full_name ?? "Siswa",
    studentNis: (stu as { nis?: string | null } | null)?.nis ?? null,
    className: (cls as { name?: string } | null)?.name ?? "-",
    attemptNumber: Number(attemptRow.attempt_number),
    status: attemptRow.status as AttemptLifecycleStatus,
    startedAtUtc: attemptRow.started_at_utc as string,
    deadlineAtUtc: attemptRow.deadline_at_utc as string,
    submittedAtUtc: (attemptRow.submitted_at_utc as string | null) ?? null,
    receiptCode: (rec as { receipt_code?: string } | null)?.receipt_code ?? null,
    answeredCount: Number((rec as { answered_count?: number } | null)?.answered_count ?? 0),
    totalQuestions: Number((rec as { total_questions?: number } | null)?.total_questions ?? questions.length),
    gradingStatus: ((gr as { grading_status?: GradingStatus } | null)?.grading_status) ?? null,
    releaseStatus:
      ((gr as { release_status?: ResultReleaseStatus } | null)?.release_status) ?? "UNRELEASED",
    objectiveScore: gr ? Number((gr as { objective_score: number | string }).objective_score) : null,
    manualScore: gr ? Number((gr as { manual_score: number | string }).manual_score) : null,
    adjustmentDelta: gr ? Number((gr as { adjustment_delta: number | string }).adjustment_delta) : null,
    totalScore: gr ? Number((gr as { total_score: number | string }).total_score) : null,
    maxScore: gr ? Number((gr as { max_score: number | string }).max_score) : null,
    percentageScore: gr ? Number((gr as { percentage_score: number | string }).percentage_score) : null,
    passed: gr ? Boolean((gr as { passed: boolean }).passed) : null,
    pendingEssayCount: gr
      ? Number((gr as { pending_manual_count: number }).pending_manual_count ?? 0)
      : 0,
  };

  return {
    summary,
    examTitle: (examJoin as { title?: string } | null)?.title ?? "Ujian",
    subjectName: subjJoin?.name ?? "-",
    passingScore: verJoin
      ? Number((verJoin as { passing_score: number | string }).passing_score)
      : Number((examJoin as { passing_score?: number | string } | null)?.passing_score ?? 70),
    questions,
    adjustments: (adjRes.data ?? []).map((adj) => {
      const adjuster = Array.isArray(adj.adjuster) ? adj.adjuster[0] : adj.adjuster;
      return {
        id: adj.id as string,
        previousTotalScore: Number(adj.previous_total_score),
        newTotalScore: Number(adj.new_total_score),
        delta: Number(adj.adjustment_delta),
        reason: adj.reason as string,
        adjustedByName: (adjuster as { full_name?: string } | null)?.full_name ?? null,
        createdAtUtc: adj.created_at_utc as string,
      };
    }),
    events: (eventsRes.data ?? []).map((ev) => ({
      id: ev.id as string,
      eventSource: ev.event_source as AttemptEventSource,
      eventType: ev.event_type as ObservedMonitoringEventType,
      metadata: (ev.metadata ?? {}) as Record<string, unknown>,
      createdAtUtc: ev.created_at_utc as string,
    })),
  };
}

export async function callGradeEssayRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    entries: Array<{
      examVersionQuestionId: string;
      assignedScore: number;
      feedback: string | null;
    }>;
    releaseIfComplete: boolean;
  }
): Promise<{
  attemptId: string;
  gradingStatus: GradingStatus;
  releaseStatus: ResultReleaseStatus;
  objectiveScore: number;
  manualScore: number;
  adjustmentDelta: number;
  totalScore: number;
  maxScore: number;
  percentageScore: number;
  passed: boolean;
  pendingManualCount: number;
}> {
  const { data, error } = await supabase.rpc("grade_essay_and_recalculate_atomic", {
    p_attempt_id: params.attemptId,
    p_entries: params.entries,
    p_release_if_complete: params.releaseIfComplete,
  });
  if (error) throw error;
  return data as {
    attemptId: string;
    gradingStatus: GradingStatus;
    releaseStatus: ResultReleaseStatus;
    objectiveScore: number;
    manualScore: number;
    adjustmentDelta: number;
    totalScore: number;
    maxScore: number;
    percentageScore: number;
    passed: boolean;
    pendingManualCount: number;
  };
}

export async function callAdjustGradeRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    newTotalScore: number;
    reason: string;
  }
): Promise<{
  attemptId: string;
  gradingStatus: GradingStatus;
  previousTotalScore: number;
  totalScore: number;
  percentageScore: number;
  passed: boolean;
}> {
  const { data, error } = await supabase.rpc("adjust_exam_grade_atomic", {
    p_attempt_id: params.attemptId,
    p_new_total_score: params.newTotalScore,
    p_reason: params.reason,
  });
  if (error) throw error;
  return data as {
    attemptId: string;
    gradingStatus: GradingStatus;
    previousTotalScore: number;
    totalScore: number;
    percentageScore: number;
    passed: boolean;
  };
}

export async function callReleaseResultsRpc(
  supabase: SupabaseClient,
  params: {
    examId: string;
    action: "release" | "unpublish";
    allowStudentReview?: boolean;
  }
): Promise<{
  examId: string;
  action: "release" | "unpublish";
  releasedCount?: number;
  pendingManualCount?: number;
  unpublishedCount?: number;
  resultsReleasedAt: string | null;
}> {
  const { data, error } = await supabase.rpc("release_exam_results_atomic", {
    p_exam_id: params.examId,
    p_action: params.action,
    p_allow_student_review: params.allowStudentReview ?? null,
  });
  if (error) throw error;
  return data as {
    examId: string;
    action: "release" | "unpublish";
    releasedCount?: number;
    pendingManualCount?: number;
    unpublishedCount?: number;
    resultsReleasedAt: string | null;
  };
}

export async function callCancelAttemptByAdminRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    reason: string;
  }
): Promise<{
  attemptId: string;
  status: "CANCELLED_BY_ADMIN";
  cancelledAtUtc: string;
}> {
  const { data, error } = await supabase.rpc("cancel_exam_attempt_by_admin", {
    p_attempt_id: params.attemptId,
    p_reason: params.reason,
  });
  if (error) throw error;
  return data as {
    attemptId: string;
    status: "CANCELLED_BY_ADMIN";
    cancelledAtUtc: string;
  };
}
