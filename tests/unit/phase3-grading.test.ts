import { describe, expect, it } from "vitest";
import { canStudentViewExamResults } from "@/domain/exams/eligibility";
import {
  computeAttemptGradeBreakdown,
  computePercentageScore,
  evaluateObjectiveQuestionResponse,
} from "@/domain/exams/grading";

describe("Phase 3 Grading Engine & Result Visibility", () => {
  it("evaluates single_choice, multiple_choice, true_false, and essays accurately", () => {
    const mcMatch = evaluateObjectiveQuestionResponse({
      questionType: "single_choice",
      scoringPolicy: "exact_match",
      maxPoints: 2.5,
      correctOptionKeys: ["C"],
      response: {
        questionType: "single_choice",
        selectedOptionKey: "A", // Student displayed key A maps canonically to C
        canonicalOptionKey: "C",
      },
    });
    expect(mcMatch.isCorrect).toBe(true);
    expect(mcMatch.awardedPoints).toBe(2.5);

    // Order-independent exact set match for multiple_choice
    const msqMatch = evaluateObjectiveQuestionResponse({
      questionType: "multiple_choice",
      scoringPolicy: "exact_match",
      maxPoints: 4,
      correctOptionKeys: ["A", "C"],
      response: {
        questionType: "multiple_choice",
        selectedOptionKeys: ["B", "D"],
        canonicalOptionKeys: ["C", "A"],
      },
    });
    expect(msqMatch.isCorrect).toBe(true);
    expect(msqMatch.awardedPoints).toBe(4);

    // Partial/extra multiple choice selection scores 0 under exact_match
    const msqPartial = evaluateObjectiveQuestionResponse({
      questionType: "multiple_choice",
      scoringPolicy: "partial_credit_disabled",
      maxPoints: 4,
      correctOptionKeys: ["A", "C"],
      response: {
        questionType: "multiple_choice",
        canonicalOptionKeys: ["A", "B", "C"],
      },
    });
    expect(msqPartial.isCorrect).toBe(false);
    expect(msqPartial.awardedPoints).toBe(0);

    // Essay is NEVER auto-scored zero
    const essay = evaluateObjectiveQuestionResponse({
      questionType: "essay",
      scoringPolicy: "manual_rubric",
      maxPoints: 10,
      correctOptionKeys: [],
      response: {
        questionType: "essay",
        textAnswer: "Penjelasan lengkap...",
      },
    });
    expect(essay.requiresManualGrading).toBe(true);
    expect(essay.isCorrect).toBeNull();
  });

  it("avoids IEEE-754 floating-point drift and separates pending essays cleanly", () => {
    const pct = computePercentageScore(17, 23);
    expect(pct).toBe(73.91);
    expect(computePercentageScore(0, 0)).toBe(0);

    // 0.1 + 0.2 decimal test + mixed essay pending
    const withPendingEssay = computeAttemptGradeBreakdown({
      passingScore: 70,
      questions: [
        {
          examVersionQuestionId: "q1",
          questionType: "single_choice",
          scoringPolicy: "exact_match",
          maxPoints: 0.1,
          correctOptionKeys: ["A"],
          response: { questionType: "single_choice", canonicalOptionKey: "A" },
        },
        {
          examVersionQuestionId: "q2",
          questionType: "true_false",
          scoringPolicy: "exact_match",
          maxPoints: 0.2,
          correctOptionKeys: ["B"],
          response: { questionType: "true_false", canonicalOptionKey: "B" },
        },
        {
          examVersionQuestionId: "q3",
          questionType: "essay",
          scoringPolicy: "manual_rubric",
          maxPoints: 0.7,
          correctOptionKeys: [],
          response: { questionType: "essay", textAnswer: "Isi esai" },
          manualAssignedScore: null,
        },
      ],
    });

    expect(withPendingEssay.objectiveScore).toBe(0.3);
    expect(withPendingEssay.manualScore).toBe(0);
    expect(withPendingEssay.maxScore).toBe(1);
    expect(withPendingEssay.gradingStatus).toBe("PENDING_MANUAL_REVIEW");
    expect(withPendingEssay.pendingManualCount).toBe(1);

    // After manual grading & audited adjustment
    const adjusted = computeAttemptGradeBreakdown({
      passingScore: 70,
      adjustmentDelta: 0.1,
      hasAdjustmentHistory: true,
      questions: [
        {
          examVersionQuestionId: "q1",
          questionType: "single_choice",
          scoringPolicy: "exact_match",
          maxPoints: 0.1,
          correctOptionKeys: ["A"],
          response: { questionType: "single_choice", canonicalOptionKey: "A" },
        },
        {
          examVersionQuestionId: "q2",
          questionType: "true_false",
          scoringPolicy: "exact_match",
          maxPoints: 0.2,
          correctOptionKeys: ["B"],
          response: { questionType: "true_false", canonicalOptionKey: "B" },
        },
        {
          examVersionQuestionId: "q3",
          questionType: "essay",
          scoringPolicy: "manual_rubric",
          maxPoints: 0.7,
          correctOptionKeys: [],
          response: { questionType: "essay", textAnswer: "Isi esai" },
          manualAssignedScore: 0.5,
        },
      ],
    });

    expect(adjusted.objectiveScore).toBe(0.3);
    expect(adjusted.manualScore).toBe(0.5);
    expect(adjusted.totalScore).toBe(0.9);
    expect(adjusted.percentageScore).toBe(90);
    expect(adjusted.passed).toBe(true);
    expect(adjusted.gradingStatus).toBe("ADJUSTED");
  });

  it("enforces controlled result release policies strictly", () => {
    const now = Date.parse("2026-11-12T10:00:00.000Z");

    expect(
      canStudentViewExamResults({
        attemptStatus: "SUBMITTED",
        gradingStatus: "PENDING_MANUAL_REVIEW",
        releaseStatus: "RELEASED",
        releasePolicy: "manual",
        scheduleEndsAtUtc: "2026-11-12T09:00:00.000Z",
        nowUtcMs: now,
      }).visible
    ).toBe(false);

    expect(
      canStudentViewExamResults({
        attemptStatus: "SUBMITTED",
        gradingStatus: "GRADED",
        releaseStatus: "UNRELEASED",
        releasePolicy: "manual",
        scheduleEndsAtUtc: "2026-11-12T09:00:00.000Z",
        nowUtcMs: now,
      }).visible
    ).toBe(false);

    expect(
      canStudentViewExamResults({
        attemptStatus: "SUBMITTED",
        gradingStatus: "GRADED",
        releaseStatus: "UNRELEASED",
        releasePolicy: "after_window_close",
        scheduleEndsAtUtc: "2026-11-12T11:00:00.000Z",
        nowUtcMs: now,
      }).visible
    ).toBe(false);

    expect(
      canStudentViewExamResults({
        attemptStatus: "SUBMITTED",
        gradingStatus: "GRADED",
        releaseStatus: "UNRELEASED",
        releasePolicy: "after_window_close",
        scheduleEndsAtUtc: "2026-11-12T09:00:00.000Z",
        nowUtcMs: now,
      }).visible
    ).toBe(true);

    expect(
      canStudentViewExamResults({
        attemptStatus: "SUBMITTED",
        gradingStatus: "GRADED",
        releaseStatus: "UNRELEASED",
        releasePolicy: "after_submit_if_no_essay",
        scheduleEndsAtUtc: "2026-11-12T12:00:00.000Z",
        nowUtcMs: now,
      }).visible
    ).toBe(true);
  });
});
