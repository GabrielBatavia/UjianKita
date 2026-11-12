import { describe, expect, it } from "vitest";
import {
  canTransitionAttemptStatus,
  canTransitionGradingStatus,
  evaluateRevisionWrite,
  isFinalizedAttemptStatus,
} from "@/domain/exams/contracts";

describe("Phase 3 Examination reliability domain contracts", () => {
  it("enforces separated attempt lifecycle transitions and blocks un-finalizing submitted/expired/cancelled attempts", () => {
    expect(canTransitionAttemptStatus("NOT_STARTED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionAttemptStatus("IN_PROGRESS", "SUBMITTING")).toBe(true);
    expect(canTransitionAttemptStatus("SUBMITTING", "SUBMITTED")).toBe(true);
    expect(canTransitionAttemptStatus("IN_PROGRESS", "EXPIRED")).toBe(true);
    expect(canTransitionAttemptStatus("IN_PROGRESS", "CANCELLED_BY_ADMIN")).toBe(true);

    // Finalized attempt cannot revert to IN_PROGRESS
    expect(canTransitionAttemptStatus("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionAttemptStatus("EXPIRED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionAttemptStatus("CANCELLED_BY_ADMIN", "IN_PROGRESS")).toBe(false);

    expect(isFinalizedAttemptStatus("SUBMITTED")).toBe(true);
    expect(isFinalizedAttemptStatus("EXPIRED")).toBe(true);
    expect(isFinalizedAttemptStatus("CANCELLED_BY_ADMIN")).toBe(true);
    expect(isFinalizedAttemptStatus("IN_PROGRESS")).toBe(false);
    expect(isFinalizedAttemptStatus("SUBMITTING")).toBe(false);
  });

  it("enforces separate grading state transitions independently from attempt lifecycle", () => {
    expect(canTransitionGradingStatus("PENDING_OBJECTIVE", "PENDING_MANUAL_REVIEW")).toBe(true);
    expect(canTransitionGradingStatus("PENDING_OBJECTIVE", "GRADED")).toBe(true);
    expect(canTransitionGradingStatus("PENDING_MANUAL_REVIEW", "GRADED")).toBe(true);
    expect(canTransitionGradingStatus("GRADED", "ADJUSTED")).toBe(true);
    expect(canTransitionGradingStatus("GRADED", "PENDING_OBJECTIVE")).toBe(false);
    expect(canTransitionGradingStatus("ADJUSTED", "PENDING_MANUAL_REVIEW")).toBe(false);
  });

  it("prevents stale writes, handles idempotent retries, detects conflicting keys, and enforces server deadline", () => {
    const deadline = 2_000_000;

    // Fresh monotonic revision succeeds
    expect(
      evaluateRevisionWrite({
        currentRevision: 2,
        incomingRevision: 3,
        knownIdempotencyHit: false,
        attemptStatus: "IN_PROGRESS",
        nowUtcMs: deadline - 5000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("COMMITTED");

    // Out-of-order stale write never overwrites newer revision
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 2,
        knownIdempotencyHit: false,
        attemptStatus: "IN_PROGRESS",
        nowUtcMs: deadline - 4000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("STALE_REVISION_REJECTED");

    // Duplicate retry returns idempotent replay
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 3,
        knownIdempotencyHit: true,
        attemptStatus: "IN_PROGRESS",
        nowUtcMs: deadline - 3000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("IDEMPOTENT_REPLAY");

    // Same idempotency key with different payload is rejected as a conflict
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 4,
        knownIdempotencyHit: true,
        idempotencyPayloadConflict: true,
        attemptStatus: "IN_PROGRESS",
        nowUtcMs: deadline - 3000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("IDEMPOTENCY_CONFLICT");

    // Write after server deadline expires is rejected
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 4,
        knownIdempotencyHit: false,
        attemptStatus: "IN_PROGRESS",
        nowUtcMs: deadline + 1000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("DEADLINE_EXPIRED");

    // Write on finalized attempt never mutates answers
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 4,
        knownIdempotencyHit: false,
        attemptStatus: "SUBMITTED",
        nowUtcMs: deadline - 1000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("ATTEMPT_ALREADY_SUBMITTED");

    // Cancelled attempt explicitly rejects saves
    expect(
      evaluateRevisionWrite({
        currentRevision: 3,
        incomingRevision: 4,
        knownIdempotencyHit: false,
        attemptStatus: "CANCELLED_BY_ADMIN",
        nowUtcMs: deadline - 1000,
        serverDeadlineUtcMs: deadline,
      })
    ).toBe("ATTEMPT_CANCELLED");
  });
});
