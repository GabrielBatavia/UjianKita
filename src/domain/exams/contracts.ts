/**
 * Future Phase 2 & Phase 3 Contracts (Architecture Preparation Only).
 *
 * These domain types and pure state transition rules define the invariants for
 * reliable computer-based testing described in the Technical Blueprint.
 * No live examination delivery, grading, or browser-lockdown enforcement is
 * implemented in Phase 1.
 */

export type AttemptStatus =
  | "ELIGIBLE"
  | "IN_PROGRESS"
  | "SUBMITTING"
  | "SUBMITTED"
  | "GRADING"
  | "GRADED"
  | "RELEASED";

const ALLOWED_ATTEMPT_TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  ELIGIBLE: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTING"],
  SUBMITTING: ["SUBMITTED", "IN_PROGRESS"], // Reverts only on failed commit before finalization
  SUBMITTED: ["GRADING"],
  GRADING: ["GRADED"],
  GRADED: ["RELEASED"],
  RELEASED: [],
};

export function canTransitionAttemptStatus(from: AttemptStatus, to: AttemptStatus): boolean {
  return ALLOWED_ATTEMPT_TRANSITIONS[from].includes(to);
}

export function isFinalizedAttemptStatus(status: AttemptStatus): boolean {
  return (
    status === "SUBMITTED" ||
    status === "GRADING" ||
    status === "GRADED" ||
    status === "RELEASED"
  );
}

export type SaveAckOutcome =
  | "COMMITTED"
  | "IDEMPOTENT_REPLAY"
  | "STALE_REVISION_REJECTED"
  | "DEADLINE_EXPIRED"
  | "ATTEMPT_ALREADY_SUBMITTED";

export interface AuthoritativeAnswerWrite {
  attemptId: string;
  questionId: string;
  clientRevision: number;
  idempotencyKey: string;
  responsePayload: unknown;
}

export interface AuthoritativeAnswerAck {
  outcome: SaveAckOutcome;
  attemptId: string;
  questionId: string;
  authoritativeRevision: number;
  committedAtUtc: string | null;
}

export interface SubmissionReceipt {
  receiptId: string;
  attemptId: string;
  examVersionId: string;
  submittedAtUtc: string;
  answeredCount: number;
  totalQuestions: number;
  integrityDigest: string;
}

export type ObservedMonitoringEventType =
  | "EXAM_STARTED"
  | "ANSWER_COMMITTED"
  | "PAGE_HIDDEN"
  | "PAGE_VISIBLE"
  | "RELOAD_RECOVERY"
  | "HEARTBEAT_MISSING"
  | "CONNECTION_RESTORED"
  | "COPY_PASTE_ATTEMPT"
  | "SUBMISSION_COMMITTED";

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
 * Pure monotonic revision evaluation helper for future Phase 2 answer engine.
 * Ensures out-of-order stale writes or duplicate idempotency keys never corrupt
 * a confirmed server revision.
 */
export function evaluateRevisionWrite(params: {
  currentRevision: number;
  incomingRevision: number;
  knownIdempotencyHit: boolean;
  attemptStatus: AttemptStatus;
  nowUtcMs: number;
  serverDeadlineUtcMs: number;
  graceWindowMs?: number;
}): SaveAckOutcome {
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
