import type {
  AttemptEventSource,
  AttemptLifecycleStatus,
  GradingStatus,
  ObservedMonitoringEventType,
  ResultReleaseStatus,
} from "@/domain/exams/contracts";
import type {
  ExamStatus,
  QuestionType,
  ResultReleasePolicy,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";

export type StudentExamCategory =
  | "tersedia"
  | "sedang_berlangsung"
  | "akan_datang"
  | "selesai"
  | "kedaluwarsa"
  | "tidak_tersedia";

export type EligibilityReasonCode =
  | "AVAILABLE_TO_START"
  | "RESUME_IN_PROGRESS"
  | "UPCOMING_WINDOW"
  | "LATE_JOIN_CUTOFF_PASSED"
  | "WINDOW_ENDED"
  | "ATTEMPT_LIMIT_REACHED"
  | "ATTEMPT_CANCELLED_NO_RETRY"
  | "EXAM_NOT_PUBLISHED"
  | "EXAM_CLOSED"
  | "NO_CLASS_SCHEDULE";

export interface StudentExamAvailabilityItem {
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
  startsAt: string | null;
  endsAt: string | null;
  questionCount: number;
  totalPoints: number;
  category: StudentExamCategory;
  reasonCode: EligibilityReasonCode;
  statusMessage: string;
  canStart: boolean;
  canResume: boolean;
  attemptsUsed: number;
  activeAttemptId: string | null;
  latestAttemptId: string | null;
  latestAttemptStatus: AttemptLifecycleStatus | null;
  latestReceiptCode: string | null;
  canViewReceipt: boolean;
  canViewResult: boolean;
}

export type StudentResponsePayload =
  | {
      questionType: "single_choice";
      selectedOptionKey: string | null;
    }
  | {
      questionType: "true_false";
      selectedOptionKey: string | null;
    }
  | {
      questionType: "multiple_choice";
      selectedOptionKeys: string[];
    }
  | {
      questionType: "essay";
      textAnswer: string;
    };

export interface StoredCanonicalAnswerPayload {
  questionType: QuestionType;
  selectedOptionKey?: string | null;
  selectedOptionKeys?: string[];
  canonicalOptionKey?: string | null;
  canonicalOptionKeys?: string[];
  textAnswer?: string;
}

export interface AttemptStudentOption {
  optionKey: string;
  optionText: string;
  displayOrder: number;
}

export interface AttemptQuestionStudentView {
  attemptQuestionId: string;
  displayIndex: number;
  questionType: QuestionType;
  stem: string;
  points: number;
  options: AttemptStudentOption[];
  currentResponse: StudentResponsePayload | null;
  latestRevision: number;
  isFlaggedForReview: boolean;
  committedAtUtc: string | null;
}

export interface ExamAttemptRecord {
  id: string;
  schoolId: string;
  examId: string;
  examVersionId: string;
  studentId: string;
  classId: string;
  attemptNumber: number;
  status: AttemptLifecycleStatus;
  startedAtUtc: string;
  deadlineAtUtc: string;
  submittedAtUtc: string | null;
  lastActivityAtUtc: string;
  timeExtensionMinutes: number;
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancelledAtUtc: string | null;
}

export interface StudentAttemptWorkspacePayload {
  attempt: ExamAttemptRecord;
  examTitle: string;
  subjectName: string;
  instructions: string | null;
  durationMinutes: number;
  requireExamBrowser: boolean;
  serverNowUtc: string;
  remainingMs: number;
  questions: AttemptQuestionStudentView[];
}

export interface AttemptTimeSyncPayload {
  attemptId: string;
  status: AttemptLifecycleStatus;
  serverNowUtc: string;
  deadlineAtUtc: string;
  remainingMs: number;
}

export interface StudentSubmissionReceiptDetail {
  receiptId: string;
  receiptCode: string;
  attemptId: string;
  examId: string;
  examVersionId: string;
  examTitle: string;
  subjectName: string;
  studentName: string;
  studentNis: string | null;
  className: string;
  attemptNumber: number;
  attemptStatus: "SUBMITTED" | "EXPIRED";
  startedAtUtc: string;
  submittedAtUtc: string;
  answeredCount: number;
  totalQuestions: number;
  integrityDigest: string;
  resultReleasePolicy: ResultReleasePolicy;
  gradingStatus: GradingStatus | null;
  releaseStatus: ResultReleaseStatus | null;
  canViewResultNow: boolean;
}

export interface StudentResultListItem {
  attemptId: string;
  examId: string;
  examTitle: string;
  subjectName: string;
  attemptNumber: number;
  attemptStatus: AttemptLifecycleStatus;
  submittedAtUtc: string | null;
  receiptCode: string | null;
  gradingStatus: GradingStatus | null;
  releaseStatus: ResultReleaseStatus;
  resultsVisible: boolean;
  withheldReason: string | null;
  objectiveScore: number | null;
  manualScore: number | null;
  adjustmentDelta: number | null;
  totalScore: number | null;
  maxScore: number | null;
  percentageScore: number | null;
  passingScore: number | null;
  passed: boolean | null;
  allowStudentReview: boolean;
}

export type LocalSyncBadgeState =
  | "Tersimpan"
  | "Menyimpan..."
  | "Menunggu koneksi"
  | "Gagal menyimpan"
  | "Sinkronisasi diperlukan";

export interface PendingAnswerQueueItem {
  attemptId: string;
  attemptQuestionId: string;
  clientRevision: number;
  idempotencyKey: string;
  payloadHash: string;
  responsePayload: StudentResponsePayload;
  isFlaggedForReview: boolean;
  updatedAtMs: number;
  attemptCount: number;
  lastError?: string | null;
}

export interface TeacherGradingAttemptSummary {
  attemptId: string;
  examId: string;
  studentId: string;
  studentUserId: string;
  studentName: string;
  studentNis: string | null;
  className: string;
  attemptNumber: number;
  status: AttemptLifecycleStatus;
  startedAtUtc: string;
  deadlineAtUtc: string;
  submittedAtUtc: string | null;
  receiptCode: string | null;
  answeredCount: number;
  totalQuestions: number;
  gradingStatus: GradingStatus | null;
  releaseStatus: ResultReleaseStatus;
  objectiveScore: number | null;
  manualScore: number | null;
  adjustmentDelta: number | null;
  totalScore: number | null;
  maxScore: number | null;
  percentageScore: number | null;
  passed: boolean | null;
  pendingEssayCount: number;
}

export interface TeacherAttemptQuestionInspection {
  attemptQuestionId: string;
  examVersionQuestionId: string;
  displayIndex: number;
  questionType: QuestionType;
  scoringPolicy: ScoringPolicy;
  stem: string;
  maxPoints: number;
  rubricNotes: string | null;
  explanation: string | null;
  options: Array<{
    displayKey: string;
    canonicalKey: string;
    optionText: string;
    isCorrect: boolean;
    wasSelected: boolean;
  }>;
  studentAnswer: StoredCanonicalAnswerPayload | null;
  isObjectiveCorrect: boolean | null;
  awardedPoints: number;
  manualEntry: {
    assignedScore: number;
    feedback: string | null;
    graderName: string | null;
    gradedAtUtc: string;
  } | null;
}

export interface TeacherAttemptDetailPayload {
  summary: TeacherGradingAttemptSummary;
  examTitle: string;
  subjectName: string;
  passingScore: number;
  questions: TeacherAttemptQuestionInspection[];
  adjustments: Array<{
    id: string;
    previousTotalScore: number;
    newTotalScore: number;
    delta: number;
    reason: string;
    adjustedByName: string | null;
    createdAtUtc: string;
  }>;
  events: Array<{
    id: string;
    eventSource: AttemptEventSource;
    eventType: ObservedMonitoringEventType;
    metadata: Record<string, unknown>;
    createdAtUtc: string;
  }>;
}
