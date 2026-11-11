import { describe, expect, it } from "vitest";
import {
  canTransitionAttemptStatus,
  evaluateRevisionWrite,
  isFinalizedAttemptStatus,
} from "@/domain/exams/contracts";

describe("Phase 2 Examination reliability domain contracts", () => {
  it("enforces valid attempt lifecycle transitions and blocks un-finalizing submitted attempts", () => {
    expect(canTransitionAttemptStatus("ELIGIBLE", "IN_PROGRESS")).toBe(true);
    expect(canTransitionAttemptStatus("IN_PROGRESS", "SUBMITTING")).toBe(true);
    expect(canTransitionAttemptStatus("SUBMITTING", "SUBMITTED")).toBe(true);

    // Finalized attempt cannot revert to IN_PROGRESS
    expect(canTransitionAttemptStatus("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionAttemptStatus("RELEASED", "GRADED")).toBe(false);
    expect(isFinalizedAttemptStatus("SUBMITTED")).toBe(true);
    expect(isFinalizedAttemptStatus("IN_PROGRESS")).toBe(false);
  });

  it("prevents stale writes, handles idempotent retries, and enforces server deadline", () => {
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
  });
});
