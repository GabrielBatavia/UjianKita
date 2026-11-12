/**
 * Examination Engine Domain Contracts (Phase 3 Authoritative Model).
 *
 * Attempt execution lifecycle, grading status, and result release status are
 * deliberately modeled as separate state machines so that submitting an attempt
 * never implies grading completion, and grading completion never implies student
 * result visibility when release policy withholds results.
 */

export type AttemptLifecycleStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTING"
  | "SUBMITTED"
  | "EXPIRED"
  | "CANCELLED_BY_ADMIN";

export type AttemptStatus = AttemptLifecycleStatus;

export type SubmissionStatus = "NONE" | "SUBMITTED" | "EXPIRED";

export type GradingStatus =
  | "PENDING_OBJECTIVE"
  | "PENDING_MANUAL_REVIEW"
  | "GRADED"
  | "ADJUSTED";

export type ResultReleaseStatus = "UNRELEASED" | "RELEASED";

const ALLOWED_ATTEMPT_TRANSITIONS: Readonly<
  Record<AttemptLifecycleStatus, readonly AttemptLifecycleStatus[]>
> = {
  NOT_STARTED: ["IN_PROGRESS", "EXPIRED", "CANCELLED_BY_ADMIN"],
  IN_PROGRESS: ["SUBMITTING", "SUBMITTED", "EXPIRED", "CANCELLED_BY_ADMIN"],
  SUBMITTING: ["SUBMITTED", "EXPIRED", "IN_PROGRESS", "CANCELLED_BY_ADMIN"],
  SUBMITTED: [],
  EXPIRED: [],
  CANCELLED_BY_ADMIN: [],
};

const ALLOWED_GRADING_TRANSITIONS: Readonly<
  Record<GradingStatus, readonly GradingStatus[]>
> = {
  PENDING_OBJECTIVE: ["PENDING_MANUAL_REVIEW", "GRADED"],
  PENDING_MANUAL_REVIEW: ["GRADED", "ADJUSTED"],
  GRADED: ["ADJUSTED"],
  ADJUSTED: ["ADJUSTED"],
};

export function canTransitionAttemptStatus(
  from: AttemptLifecycleStatus,
  to: AttemptLifecycleStatus
): boolean {
  return ALLOWED_ATTEMPT_TRANSITIONS[from].includes(to);
}

export function canTransitionGradingStatus(from: GradingStatus, to: GradingStatus): boolean {
  return ALLOWED_GRADING_TRANSITIONS[from].includes(to);
}

export function isFinalizedAttemptStatus(status: AttemptLifecycleStatus): boolean {
  return (
    status === "SUBMITTED" || status === "EXPIRED" || status === "CANCELLED_BY_ADMIN"
  );
}

export type SaveAckOutcome =
  | "COMMITTED"
  | "IDEMPOTENT_REPLAY"
  | "IDEMPOTENCY_CONFLICT"
  | "STALE_REVISION_REJECTED"
  | "DEADLINE_EXPIRED"
  | "ATTEMPT_ALREADY_SUBMITTED"
  | "ATTEMPT_CANCELLED";

export interface AuthoritativeAnswerWrite {
  attemptId: string;
  attemptQuestionId: string;
  clientRevision: number;
  idempotencyKey: string;
  payloadHash: string;
  responsePayload: unknown;
  isFlaggedForReview?: boolean;
}

export interface AuthoritativeAnswerAck {
  outcome: SaveAckOutcome;
  attemptId: string;
  attemptQuestionId: string;
  authoritativeRevision: number;
  committedAtUtc: string | null;
  serverNowUtc: string;
  message?: string;
}

export interface SubmissionReceipt {
  receiptId: string;
  receiptCode: string;
  attemptId: string;
  examId: string;
  examVersionId: string;
  attemptStatus: "SUBMITTED" | "EXPIRED";
  submittedAtUtc: string;
  answeredCount: number;
  totalQuestions: number;
  integrityDigest: string;
}

export type AttemptEventSource = "server_confirmed" | "client_reported" | "server_inferred";

export type ObservedMonitoringEventType =
  | "ATTEMPT_STARTED"
  | "ATTEMPT_RESUMED"
  | "EXAM_STARTED"
  | "ANSWER_COMMITTED"
  | "ANSWER_FLAGGED"
  | "SUBMISSION_REQUESTED"
  | "SUBMISSION_COMMITTED"
  | "ATTEMPT_EXPIRED"
  | "ATTEMPT_CANCELLED"
  | "GRADE_FINALIZED"
  | "GRADE_ADJUSTED"
  | "RESULTS_RELEASED"
  | "PAGE_HIDDEN"
  | "PAGE_VISIBLE"
  | "RELOAD_RECOVERY"
  | "HEARTBEAT_MISSING"
  | "CONNECTION_LOST"
  | "CONNECTION_RESTORED"
  | "STORAGE_WARNING"
  | "COPY_PASTE_ATTEMPT"
  | "EXIT_ATTEMPT";

export type ExamBrowserPlatform = "android_exambro" | "ios_seb" | "standard_browser";

export type VerificationTrustLevel =
  | "protocol_verified" // e.g., SEB ConfigKey/BrowserExamKey validated server-side
  | "unverified_client_hint" // e.g., User-Agent string; NEVER treated as proof of authenticity
  | "none";

export interface ExamBrowserCapabilityAssessment {
  platform: ExamBrowserPlatform;
  productIdentifier: string | null;
  verificationTrust: VerificationTrustLevel;
  canVerifyConfigCryptographically: boolean;
  screenshotPreventionClaimed: false; // Web layer never claims OS-level screenshot blocking
  notes: string;
}

export interface ExamBrowserVerifier {
  assessClientEnvironment(input: {
    userAgent: string;
    sebConfigKeyHash?: string;
    sebBrowserExamKeyHash?: string;
    requestUrl: string;
  }): Promise<ExamBrowserCapabilityAssessment>;
}

/**
 * Pure monotonic revision evaluation helper for authoritative answer saves.
 * Ensures out-of-order stale writes or duplicate idempotency keys never corrupt
 * a confirmed server revision, and conflicting idempotency reuse fails loudly.
 */
export function evaluateRevisionWrite(params: {
  currentRevision: number;
  incomingRevision: number;
  knownIdempotencyHit: boolean;
  idempotencyPayloadConflict?: boolean;
  attemptStatus: AttemptLifecycleStatus;
  nowUtcMs: number;
  serverDeadlineUtcMs: number;
  graceWindowMs?: number;
}): SaveAckOutcome {
  if (params.knownIdempotencyHit && params.idempotencyPayloadConflict) {
    return "IDEMPOTENCY_CONFLICT";
  }

  if (params.attemptStatus === "CANCELLED_BY_ADMIN") {
    return "ATTEMPT_CANCELLED";
  }

  if (isFinalizedAttemptStatus(params.attemptStatus)) {
    return params.knownIdempotencyHit ? "IDEMPOTENT_REPLAY" : "ATTEMPT_ALREADY_SUBMITTED";
  }

  if (params.knownIdempotencyHit) {
    return "IDEMPOTENT_REPLAY";
  }

  const effectiveDeadline = params.serverDeadlineUtcMs + (params.graceWindowMs ?? 0);
  if (params.nowUtcMs > effectiveDeadline) {
    return "DEADLINE_EXPIRED";
  }

  if (params.incomingRevision <= params.currentRevision) {
    return "STALE_REVISION_REJECTED";
  }

  return "COMMITTED";
}
