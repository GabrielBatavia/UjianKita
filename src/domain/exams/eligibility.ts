import type { AttemptLifecycleStatus } from "@/domain/exams/contracts";
import {
  computeDeterministicShuffleSeed,
  deterministicShuffleWithPins,
} from "@/domain/exams/exam-lifecycle";
import type {
  ExamStatus,
  QuestionOptionItem,
  QuestionType,
  ResultReleasePolicy,
} from "@/domain/exams/phase2-types";
import type {
  EligibilityReasonCode,
  StudentExamCategory,
} from "@/domain/exams/phase3-types";

export interface ExamEligibilityInput {
  examStatus: ExamStatus;
  publishedVersionId: string | null;
  hasClassSchedule: boolean;
  startsAtUtc: string | null;
  endsAtUtc: string | null;
  durationMinutes: number;
  maxAttempts: number;
  lateJoinMinutes: number;
  nowUtcMs: number;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: AttemptLifecycleStatus;
    deadlineAtUtc: string;
    submittedAtUtc: string | null;
  }>;
}

export interface ExamEligibilityResult {
  category: StudentExamCategory;
  reasonCode: EligibilityReasonCode;
  statusMessage: string;
  canStart: boolean;
  canResume: boolean;
  activeAttemptId: string | null;
  attemptsUsed: number;
  canViewReceipt: boolean;
}

/**
 * Classifies an exam strictly on authoritative server UTC timestamps and
 * student attempt history. Client clocks are never trusted for access control.
 */
export function classifyStudentExamEligibility(
  input: ExamEligibilityInput
): ExamEligibilityResult {
  const attemptsSorted = [...input.attempts].sort(
    (a, b) => b.attemptNumber - a.attemptNumber
  );
  const attemptsUsed = attemptsSorted.length;

  const activeAttempt = attemptsSorted.find(
    (a) => a.status === "IN_PROGRESS" || a.status === "SUBMITTING"
  );

  const finalizedReceiptAttempt = attemptsSorted.find(
    (a) => a.status === "SUBMITTED" || a.status === "EXPIRED"
  );

  if (!input.hasClassSchedule) {
    return {
      category: "tidak_tersedia",
      reasonCode: "NO_CLASS_SCHEDULE",
      statusMessage: "Ujian belum dijadwalkan untuk kelas Anda.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (!input.publishedVersionId || input.examStatus === "DRAFT" || input.examStatus === "READY_FOR_REVIEW") {
    return {
      category: "tidak_tersedia",
      reasonCode: "EXAM_NOT_PUBLISHED",
      statusMessage: "Ujian belum dipublikasikan oleh guru.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (input.examStatus === "ARCHIVED") {
    return {
      category: "tidak_tersedia",
      reasonCode: "EXAM_CLOSED",
      statusMessage: "Ujian telah diarsipkan.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  // Active in-progress attempt takes precedence if deadline has not passed
  if (activeAttempt) {
    const deadlineMs = Date.parse(activeAttempt.deadlineAtUtc);
    if (Number.isFinite(deadlineMs) && input.nowUtcMs <= deadlineMs) {
      return {
        category: "sedang_berlangsung",
        reasonCode: "RESUME_IN_PROGRESS",
        statusMessage: "Sesi ujian Anda sedang berlangsung dan dapat dilanjutkan.",
        canStart: false,
        canResume: true,
        activeAttemptId: activeAttempt.id,
        attemptsUsed,
        canViewReceipt: finalizedReceiptAttempt !== undefined,
      };
    }

    // Active attempt deadline expired while still open
    return {
      category: "kedaluwarsa",
      reasonCode: "WINDOW_ENDED",
      statusMessage: "Batas waktu sesi ujian Anda telah berakhir dan akan difinalisasi.",
      canStart: false,
      canResume: false,
      activeAttemptId: activeAttempt.id,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (attemptsUsed > 0 && attemptsSorted.every((a) => a.status === "SUBMITTED")) {
    if (attemptsUsed >= input.maxAttempts) {
      return {
        category: "selesai",
        reasonCode: "ATTEMPT_LIMIT_REACHED",
        statusMessage: "Anda telah menyelesaikan seluruh kesempatan pengerjaan ujian ini.",
        canStart: false,
        canResume: false,
        activeAttemptId: null,
        attemptsUsed,
        canViewReceipt: true,
      };
    }
  }

  if (attemptsUsed > 0 && finalizedReceiptAttempt && attemptsUsed >= input.maxAttempts) {
    const anySubmitted = attemptsSorted.some((a) => a.status === "SUBMITTED");
    return {
      category: anySubmitted ? "selesai" : "kedaluwarsa",
      reasonCode: anySubmitted ? "ATTEMPT_LIMIT_REACHED" : "WINDOW_ENDED",
      statusMessage: anySubmitted
        ? "Anda telah menyelesaikan ujian ini."
        : "Kesempatan ujian berakhir karena batas waktu habis.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: true,
    };
  }

  const latestAttempt = attemptsSorted[0];
  if (latestAttempt?.status === "CANCELLED_BY_ADMIN" && attemptsUsed >= input.maxAttempts) {
    return {
      category: "tidak_tersedia",
      reasonCode: "ATTEMPT_CANCELLED_NO_RETRY",
      statusMessage: "Sesi ujian dibatalkan oleh administrator dan tidak tersedia lagi.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (input.examStatus === "CLOSED") {
    if (finalizedReceiptAttempt) {
      return {
        category: "selesai",
        reasonCode: "EXAM_CLOSED",
        statusMessage: "Ujian telah ditutup setelah pengerjaan selesai.",
        canStart: false,
        canResume: false,
        activeAttemptId: null,
        attemptsUsed,
        canViewReceipt: true,
      };
    }
    return {
      category: "kedaluwarsa",
      reasonCode: "EXAM_CLOSED",
      statusMessage: "Jendela ujian telah ditutup oleh penyelenggara.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: false,
    };
  }

  const startsAtMs = input.startsAtUtc ? Date.parse(input.startsAtUtc) : NaN;
  const endsAtMs = input.endsAtUtc ? Date.parse(input.endsAtUtc) : NaN;

  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
    return {
      category: "tidak_tersedia",
      reasonCode: "NO_CLASS_SCHEDULE",
      statusMessage: "Jadwal waktu ujian belum lengkap.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (input.nowUtcMs < startsAtMs) {
    return {
      category: "akan_datang",
      reasonCode: "UPCOMING_WINDOW",
      statusMessage: "Jendela ujian belum dibuka.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  if (input.nowUtcMs > endsAtMs) {
    if (finalizedReceiptAttempt) {
      return {
        category: finalizedReceiptAttempt.status === "SUBMITTED" ? "selesai" : "kedaluwarsa",
        reasonCode: "WINDOW_ENDED",
        statusMessage: "Jendela pelaksanaan ujian telah berakhir.",
        canStart: false,
        canResume: false,
        activeAttemptId: null,
        attemptsUsed,
        canViewReceipt: true,
      };
    }
    return {
      category: "kedaluwarsa",
      reasonCode: "WINDOW_ENDED",
      statusMessage: "Jendela pelaksanaan ujian telah berakhir sebelum Anda memulai.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: false,
    };
  }

  const lateJoinDeadlineMs = startsAtMs + Math.max(0, input.lateJoinMinutes) * 60_000;
  if (input.lateJoinMinutes > 0 && input.nowUtcMs > lateJoinDeadlineMs && attemptsUsed === 0) {
    return {
      category: "kedaluwarsa",
      reasonCode: "LATE_JOIN_CUTOFF_PASSED",
      statusMessage: "Batas toleransi keterlambatan masuk ujian telah terlewati.",
      canStart: false,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: false,
    };
  }

  if (attemptsUsed < input.maxAttempts) {
    return {
      category: "tersedia",
      reasonCode: "AVAILABLE_TO_START",
      statusMessage: "Ujian tersedia dan siap dimulai.",
      canStart: true,
      canResume: false,
      activeAttemptId: null,
      attemptsUsed,
      canViewReceipt: finalizedReceiptAttempt !== undefined,
    };
  }

  return {
    category: finalizedReceiptAttempt ? "selesai" : "tidak_tersedia",
    reasonCode: "ATTEMPT_LIMIT_REACHED",
    statusMessage: "Batas percobaan ujian telah tercapai.",
    canStart: false,
    canResume: false,
    activeAttemptId: null,
    attemptsUsed,
    canViewReceipt: finalizedReceiptAttempt !== undefined,
  };
}

/**
 * Computes the strict authoritative UTC deadline for an attempt:
 * MIN(started_at + (duration + extension), schedule_ends_at + extension).
 */
export function computeAttemptDeadlineUtcMs(params: {
  startedAtUtcMs: number;
  durationMinutes: number;
  scheduleEndsAtUtcMs: number;
  timeExtensionMinutes?: number;
}): number {
  const extensionMs = Math.max(0, params.timeExtensionMinutes ?? 0) * 60_000;
  const durationCapMs = params.startedAtUtcMs + params.durationMinutes * 60_000 + extensionMs;
  const windowCapMs = params.scheduleEndsAtUtcMs + extensionMs;
  return Math.min(durationCapMs, windowCapMs);
}

export function computeRemainingTimeMs(
  deadlineUtcMs: number,
  nowUtcMs: number
): { remainingMs: number; isExpired: boolean } {
  const diff = deadlineUtcMs - nowUtcMs;
  if (diff <= 0) {
    return { remainingMs: 0, isExpired: true };
  }
  return { remainingMs: diff, isExpired: false };
}

export interface SnapshotQuestionSeedInput {
  examVersionQuestionId: string;
  questionType: QuestionType;
  stem: string;
  points: number;
  displayOrder: number;
  preserveOrder: boolean;
  preserveOptionOrder: boolean;
  options: QuestionOptionItem[];
}

export interface RealizedAttemptQuestionAssignment {
  examVersionQuestionId: string;
  displayIndex: number;
  questionType: QuestionType;
  stemSnapshot: string;
  pointsSnapshot: number;
  /** Maps student-visible option key (A, B, C...) -> canonical question optionKey */
  optionOrderMap: Record<string, string>;
  optionsSnapshot: Array<{
    optionKey: string;
    optionText: string;
    displayOrder: number;
  }>;
}

const DISPLAY_OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/**
 * Generates deterministic per-attempt question order and option order maps so
 * refreshes or reconnects never re-shuffle questions/options, while option labels
 * shown to students remain orderly (A, B, C...) and map back to canonical keys.
 */
export function buildDeterministicAttemptAssignments(params: {
  attemptId: string;
  examVersionId: string;
  randomizeQuestions: boolean;
  randomizeOptions: boolean;
  questions: SnapshotQuestionSeedInput[];
}): RealizedAttemptQuestionAssignment[] {
  const baseSorted = [...params.questions].sort((a, b) => a.displayOrder - b.displayOrder);
  const baseSeed = computeDeterministicShuffleSeed(params.attemptId, params.examVersionId);

  const orderedQuestions = params.randomizeQuestions
    ? deterministicShuffleWithPins(baseSorted, baseSeed, (q) => q.preserveOrder)
    : baseSorted;

  return orderedQuestions.map((question, idx) => {
    const baseOptions = [...question.options].sort((a, b) => a.displayOrder - b.displayOrder);
    const shouldShuffleOptions =
      params.randomizeOptions &&
      !question.preserveOptionOrder &&
      question.questionType !== "true_false" &&
      question.questionType !== "essay" &&
      baseOptions.length > 1;

    const optionSeed = computeDeterministicShuffleSeed(
      `${params.attemptId}:${question.examVersionQuestionId}`,
      params.examVersionId
    );

    const arrangedOptions = shouldShuffleOptions
      ? deterministicShuffleWithPins(baseOptions, optionSeed, () => false)
      : baseOptions;

    const optionOrderMap: Record<string, string> = {};
    const optionsSnapshot = arrangedOptions.map((opt, optIdx) => {
      // Preserve true_false canonical keys (e.g., B/S or T/F) or assign clean A..H display labels
      const displayKey =
        shouldShuffleOptions && optIdx < DISPLAY_OPTION_LABELS.length
          ? DISPLAY_OPTION_LABELS[optIdx]!
          : opt.optionKey;

      optionOrderMap[displayKey] = opt.optionKey;
      return {
        optionKey: displayKey,
        optionText: opt.optionText,
        displayOrder: optIdx,
      };
    });

    return {
      examVersionQuestionId: question.examVersionQuestionId,
      displayIndex: idx + 1,
      questionType: question.questionType,
      stemSnapshot: question.stem,
      pointsSnapshot: question.points,
      optionOrderMap,
      optionsSnapshot,
    };
  });
}

/**
 * Determines whether a student may view detailed results according to attempt state,
 * grading completion, and release policy.
 */
export function canStudentViewExamResults(params: {
  attemptStatus: AttemptLifecycleStatus;
  gradingStatus: "PENDING_OBJECTIVE" | "PENDING_MANUAL_REVIEW" | "GRADED" | "ADJUSTED" | null;
  releaseStatus: "UNRELEASED" | "RELEASED";
  releasePolicy: ResultReleasePolicy;
  scheduleEndsAtUtc: string | null;
  nowUtcMs: number;
}): { visible: boolean; reason: string | null } {
  if (params.attemptStatus === "CANCELLED_BY_ADMIN") {
    return {
      visible: false,
      reason: "Sesi ujian dibatalkan oleh administrator.",
    };
  }

  if (params.attemptStatus !== "SUBMITTED" && params.attemptStatus !== "EXPIRED") {
    return {
      visible: false,
      reason: "Ujian belum selesai dikumpulkan.",
    };
  }

  if (!params.gradingStatus || params.gradingStatus === "PENDING_OBJECTIVE") {
    return {
      visible: false,
      reason: "Penilaian otomatis sedang diproses.",
    };
  }

  if (params.gradingStatus === "PENDING_MANUAL_REVIEW") {
    return {
      visible: false,
      reason: "Menunggu penilaian soal esai oleh guru.",
    };
  }

  if (params.releaseStatus === "RELEASED") {
    return { visible: true, reason: null };
  }

  if (params.releasePolicy === "after_submit_if_no_essay") {
    return { visible: true, reason: null };
  }

  if (params.releasePolicy === "after_window_close" && params.scheduleEndsAtUtc) {
    const endsMs = Date.parse(params.scheduleEndsAtUtc);
    if (Number.isFinite(endsMs) && params.nowUtcMs >= endsMs) {
      return { visible: true, reason: null };
    }
    return {
      visible: false,
      reason: "Hasil akan ditampilkan otomatis setelah jendela jadwal ujian berakhir.",
    };
  }

  return {
    visible: false,
    reason: "Hasil ujian belum dirilis oleh guru.",
  };
}
