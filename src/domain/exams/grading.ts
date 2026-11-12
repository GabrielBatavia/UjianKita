import type { GradingStatus } from "@/domain/exams/contracts";
import type { QuestionType, ScoringPolicy } from "@/domain/exams/phase2-types";
import type { StoredCanonicalAnswerPayload } from "@/domain/exams/phase3-types";

const SCALE = 100;

export function toScaledPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * SCALE);
}

export function fromScaledPoints(scaled: number): number {
  return Math.round(scaled) / SCALE;
}

export function roundToTwoDecimals(value: number): number {
  return fromScaledPoints(toScaledPoints(value));
}

export function computePercentageScore(earnedScore: number, maxScore: number): number {
  const maxScaled = toScaledPoints(maxScore);
  if (maxScaled <= 0) return 0;
  const earnedScaled = toScaledPoints(earnedScore);
  // Multiply first cleanly before division to minimize truncation error
  const pctScaled = Math.round((earnedScaled * 100 * SCALE) / maxScaled);
  return pctScaled / SCALE;
}

export interface ObjectiveEvaluationResult {
  isObjective: boolean;
  requiresManualGrading: boolean;
  isCorrect: boolean | null;
  awardedPoints: number;
}

/**
 * Pure deterministic objective question scorer operating strictly on canonical
 * option keys (mapped back from student display order before grading).
 * Essays are NEVER silently scored zero — they return requiresManualGrading=true.
 */
export function evaluateObjectiveQuestionResponse(params: {
  questionType: QuestionType;
  scoringPolicy: ScoringPolicy;
  maxPoints: number;
  correctOptionKeys: readonly string[];
  response: StoredCanonicalAnswerPayload | null;
}): ObjectiveEvaluationResult {
  if (params.questionType === "essay" || params.scoringPolicy === "manual_rubric") {
    return {
      isObjective: false,
      requiresManualGrading: true,
      isCorrect: null,
      awardedPoints: 0,
    };
  }

  const maxPointsClean = roundToTwoDecimals(Math.max(0, params.maxPoints));
  const canonicalCorrect = Array.from(
    new Set(params.correctOptionKeys.map((k) => k.trim()).filter((k) => k.length > 0))
  ).sort();

  if (!params.response) {
    return {
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: false,
      awardedPoints: 0,
    };
  }

  if (params.questionType === "single_choice" || params.questionType === "true_false") {
    const selected = (
      params.response.canonicalOptionKey ??
      params.response.selectedOptionKey ??
      ""
    ).trim();

    const matched =
      canonicalCorrect.length === 1 && selected.length > 0 && selected === canonicalCorrect[0];

    return {
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: matched,
      awardedPoints: matched ? maxPointsClean : 0,
    };
  }

  // multiple_choice: order-independent, exact set equality
  const selectedRaw =
    params.response.canonicalOptionKeys ?? params.response.selectedOptionKeys ?? [];
  const selectedSet = Array.from(
    new Set(selectedRaw.map((k) => k.trim()).filter((k) => k.length > 0))
  ).sort();

  const matched =
    canonicalCorrect.length > 0 &&
    selectedSet.length === canonicalCorrect.length &&
    selectedSet.every((key, idx) => key === canonicalCorrect[idx]);

  return {
    isObjective: true,
    requiresManualGrading: false,
    isCorrect: matched,
    awardedPoints: matched ? maxPointsClean : 0,
  };
}

export interface GradeComputationQuestionInput {
  examVersionQuestionId: string;
  questionType: QuestionType;
  scoringPolicy: ScoringPolicy;
  maxPoints: number;
  correctOptionKeys: readonly string[];
  response: StoredCanonicalAnswerPayload | null;
  manualAssignedScore?: number | null;
}

export interface ComputedGradeBreakdown {
  objectiveScore: number;
  manualScore: number;
  adjustmentDelta: number;
  totalScore: number;
  maxScore: number;
  percentageScore: number;
  passed: boolean;
  gradingStatus: GradingStatus;
  pendingManualCount: number;
}

/**
 * Recomputes complete attempt grading totals using exact scaled integer math to
 * guarantee zero floating-point drift across fractional question weights.
 */
export function computeAttemptGradeBreakdown(params: {
  questions: readonly GradeComputationQuestionInput[];
  passingScore: number;
  adjustmentDelta?: number;
  hasAdjustmentHistory?: boolean;
}): ComputedGradeBreakdown {
  let objectiveScaled = 0;
  let manualScaled = 0;
  let maxScaled = 0;
  let pendingManualCount = 0;

  for (const q of params.questions) {
    const qMaxScaled = Math.max(0, toScaledPoints(q.maxPoints));
    maxScaled += qMaxScaled;

    const evalResult = evaluateObjectiveQuestionResponse({
      questionType: q.questionType,
      scoringPolicy: q.scoringPolicy,
      maxPoints: q.maxPoints,
      correctOptionKeys: q.correctOptionKeys,
      response: q.response,
    });

    if (evalResult.requiresManualGrading) {
      if (q.manualAssignedScore === null || q.manualAssignedScore === undefined) {
        pendingManualCount += 1;
      } else {
        const clamped = Math.min(
          qMaxScaled,
          Math.max(0, toScaledPoints(q.manualAssignedScore))
        );
        manualScaled += clamped;
      }
    } else {
      objectiveScaled += toScaledPoints(evalResult.awardedPoints);
    }
  }

  const adjScaled = toScaledPoints(params.adjustmentDelta ?? 0);
  const rawTotalScaled = objectiveScaled + manualScaled + adjScaled;
  const clampedTotalScaled = Math.min(maxScaled, Math.max(0, rawTotalScaled));

  const objectiveScore = fromScaledPoints(objectiveScaled);
  const manualScore = fromScaledPoints(manualScaled);
  const adjustmentDelta = fromScaledPoints(adjScaled);
  const totalScore = fromScaledPoints(clampedTotalScaled);
  const maxScore = fromScaledPoints(maxScaled);
  const percentageScore = computePercentageScore(totalScore, maxScore);
  const passed = toScaledPoints(percentageScore) >= toScaledPoints(params.passingScore);

  let gradingStatus: GradingStatus;
  if (pendingManualCount > 0) {
    gradingStatus = "PENDING_MANUAL_REVIEW";
  } else if (params.hasAdjustmentHistory || adjScaled !== 0) {
    gradingStatus = "ADJUSTED";
  } else {
    gradingStatus = "GRADED";
  }

  return {
    objectiveScore,
    manualScore,
    adjustmentDelta,
    totalScore,
    maxScore,
    percentageScore,
    passed,
    gradingStatus,
    pendingManualCount,
  };
}
