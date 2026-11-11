import { describe, expect, it } from "vitest";
import type {
  ExamClassAssignmentItem,
  ExamDraftQuestionItem,
  ExamRecord,
  ExamScheduleItem,
  QuestionRecord,
} from "@/domain/exams/phase2-types";
import {
  canTransitionExamStatus,
  computeDeterministicShuffleSeed,
  detectScheduleConflicts,
  deterministicShuffleWithPins,
  isExamEditable,
  validateExamReadiness,
} from "@/domain/exams/exam-lifecycle";

const BASE_EXAM: ExamRecord = {
  id: "exam-1",
  school_id: "school-1",
  subject_id: "subj-1",
  academic_year_id: "year-1",
  created_by: "teacher-1",
  title: "PTS Matematika",
  description: null,
  instructions: "Kerjakan dengan jujur.",
  status: "DRAFT",
  duration_minutes: 60,
  max_attempts: 1,
  passing_score: 70,
  randomize_questions: true,
  randomize_options: true,
  starts_at: "2026-11-20T08:00:00.000Z",
  ends_at: "2026-11-20T10:00:00.000Z",
  published_version_id: null,
  version_lock: 1,
  created_at: "2026-11-12T00:00:00.000Z",
  updated_at: "2026-11-12T00:00:00.000Z",
};

function makeDraftQuestion(overrides: Partial<QuestionRecord> = {}, points = 50): ExamDraftQuestionItem {
  const qId = overrides.id ?? "q-1";
  const question: QuestionRecord = {
    id: qId,
    school_id: "school-1",
    question_bank_id: "bank-1",
    subject_id: "subj-1",
    created_by: "teacher-1",
    current_version_id: "qv-1",
    question_type: "single_choice",
    difficulty: "medium",
    topic: "Aljabar",
    tags: [],
    status: "active",
    attachment_metadata: [],
    content_fingerprint: "abc",
    created_at: "2026-11-12T00:00:00.000Z",
    updated_at: "2026-11-12T00:00:00.000Z",
    ...overrides,
    current_version: {
      id: "qv-1",
      question_id: qId,
      version_number: 1,
      stem: "Contoh pertanyaan matematika?",
      explanation: null,
      points,
      scoring_policy: "exact_match",
      rubric_notes: null,
      preserve_option_order: false,
      created_by: "teacher-1",
      created_at: "2026-11-12T00:00:00.000Z",
      options: [
        { optionKey: "A", optionText: "1", displayOrder: 0 },
        { optionKey: "B", optionText: "2", displayOrder: 1 },
      ],
      correct_option_keys: overrides.question_type === "essay" ? [] : ["A"],
    },
  };

  return {
    id: `dq-${qId}`,
    exam_id: "exam-1",
    question_id: qId,
    display_order: 1,
    points_override: null,
    preserve_order: false,
    question,
  };
}

const ASSIGNMENTS: ExamClassAssignmentItem[] = [
  {
    id: "a-1",
    exam_id: "exam-1",
    class_id: "class-1",
    class_name: "X IPA 1",
    grade_level: "10",
    student_count: 32,
  },
];

describe("Examination lifecycle, validation, scheduling & randomization", () => {
  it("enforces valid status transitions and immutability guards", () => {
    expect(canTransitionExamStatus("DRAFT", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransitionExamStatus("READY_FOR_REVIEW", "PUBLISHED")).toBe(true);
    expect(canTransitionExamStatus("PUBLISHED", "CLOSED")).toBe(true);
    expect(canTransitionExamStatus("ARCHIVED", "PUBLISHED")).toBe(false);
    expect(canTransitionExamStatus("DRAFT", "PUBLISHED")).toBe(false);

    expect(isExamEditable("DRAFT")).toBe(true);
    expect(isExamEditable("PUBLISHED")).toBe(false);
    expect(isExamEditable("ARCHIVED")).toBe(false);
  });

  it("passes readiness checklist for complete exams and catches incomplete configs", () => {
    const ready = validateExamReadiness({
      exam: BASE_EXAM,
      draftQuestions: [
        makeDraftQuestion({ id: "q-1" }, 50),
        makeDraftQuestion({ id: "q-2" }, 50),
      ],
      assignments: ASSIGNMENTS,
    });
    expect(ready.ready).toBe(true);
    expect(ready.totalPoints).toBe(100);
    expect(ready.totalQuestions).toBe(2);

    // Fails when window shorter than duration
    const shortWindow = validateExamReadiness({
      exam: {
        ...BASE_EXAM,
        starts_at: "2026-11-20T08:00:00.000Z",
        ends_at: "2026-11-20T08:30:00.000Z",
      },
      draftQuestions: [makeDraftQuestion({ id: "q-1" }, 100)],
      assignments: ASSIGNMENTS,
    });
    expect(shortWindow.ready).toBe(false);

    // Fails when an archived question is present
    const withArchived = validateExamReadiness({
      exam: BASE_EXAM,
      draftQuestions: [makeDraftQuestion({ id: "q-1", status: "archived" }, 100)],
      assignments: ASSIGNMENTS,
    });
    expect(withArchived.ready).toBe(false);

    // Fails when passing score exceeds total points
    const excessivePassing = validateExamReadiness({
      exam: { ...BASE_EXAM, passing_score: 90 },
      draftQuestions: [makeDraftQuestion({ id: "q-1" }, 50)],
      assignments: ASSIGNMENTS,
    });
    expect(excessivePassing.ready).toBe(false);
  });

  it("detects overlapping schedules on the same class while ignoring archived exams", () => {
    const existingSchedules: ExamScheduleItem[] = [
      {
        id: "s-other",
        exam_id: "exam-2",
        exam_title: "Ujian Fisika",
        exam_status: "PUBLISHED",
        class_id: "class-1",
        class_name: "X IPA 1",
        starts_at: "2026-11-20T09:00:00.000Z",
        ends_at: "2026-11-20T11:00:00.000Z",
        duration_minutes: 60,
        max_attempts: 1,
        late_join_minutes: 15,
        require_exam_browser: true,
      },
      {
        id: "s-archived",
        exam_id: "exam-3",
        exam_title: "Ujian Lama",
        exam_status: "ARCHIVED",
        class_id: "class-1",
        class_name: "X IPA 1",
        starts_at: "2026-11-20T08:30:00.000Z",
        ends_at: "2026-11-20T09:30:00.000Z",
        duration_minutes: 60,
        max_attempts: 1,
        late_join_minutes: 15,
        require_exam_browser: true,
      },
    ];

    const conflicts = detectScheduleConflicts({
      examId: "exam-1",
      startsAt: BASE_EXAM.starts_at,
      endsAt: BASE_EXAM.ends_at,
      assignedClassIds: ["class-1"],
      schoolSchedules: existingSchedules,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.conflictingExamId).toBe("exam-2");
  });

  it("shuffles deterministically from persisted seed and preserves pinned items", () => {
    const items = [
      { id: "q1", pinned: false },
      { id: "q2", pinned: true },
      { id: "q3", pinned: false },
      { id: "q4", pinned: false },
      { id: "q5", pinned: false },
    ];

    const seed = computeDeterministicShuffleSeed("attempt-abc", "version-xyz");
    const run1 = deterministicShuffleWithPins(items, seed, (i) => i.pinned);
    const run2 = deterministicShuffleWithPins(items, seed, (i) => i.pinned);

    expect(run1.map((i) => i.id)).toEqual(run2.map((i) => i.id));
    expect(run1[1]?.id).toBe("q2"); // Pinned item stays at index 1
  });
});
