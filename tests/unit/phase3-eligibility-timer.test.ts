import { describe, expect, it } from "vitest";
import {
  buildDeterministicAttemptAssignments,
  classifyStudentExamEligibility,
  computeAttemptDeadlineUtcMs,
  computeRemainingTimeMs,
} from "@/domain/exams/eligibility";

describe("Phase 3 Eligibility & Server-Authoritative Timing", () => {
  const startIso = "2026-11-12T01:00:00.000Z";
  const endIso = "2026-11-12T03:00:00.000Z";
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);

  it("classifies unassigned and unpublished exams as tidak_tersedia", () => {
    const noSchedule = classifyStudentExamEligibility({
      examStatus: "PUBLISHED",
      publishedVersionId: "ver-1",
      hasClassSchedule: false,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs + 60_000,
      attempts: [],
    });
    expect(noSchedule.category).toBe("tidak_tersedia");
    expect(noSchedule.reasonCode).toBe("NO_CLASS_SCHEDULE");
    expect(noSchedule.canStart).toBe(false);

    const draft = classifyStudentExamEligibility({
      examStatus: "DRAFT",
      publishedVersionId: null,
      hasClassSchedule: true,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs + 60_000,
      attempts: [],
    });
    expect(draft.category).toBe("tidak_tersedia");
    expect(draft.reasonCode).toBe("EXAM_NOT_PUBLISHED");
  });

  it("enforces upcoming window, available start, and late-join cutoff", () => {
    const upcoming = classifyStudentExamEligibility({
      examStatus: "PUBLISHED",
      publishedVersionId: "ver-1",
      hasClassSchedule: true,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs - 60_000,
      attempts: [],
    });
    expect(upcoming.category).toBe("akan_datang");
    expect(upcoming.canStart).toBe(false);

    const available = classifyStudentExamEligibility({
      examStatus: "PUBLISHED",
      publishedVersionId: "ver-1",
      hasClassSchedule: true,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs + 10 * 60_000,
      attempts: [],
    });
    expect(available.category).toBe("tersedia");
    expect(available.canStart).toBe(true);

    const lateExpired = classifyStudentExamEligibility({
      examStatus: "PUBLISHED",
      publishedVersionId: "ver-1",
      hasClassSchedule: true,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs + 16 * 60_000,
      attempts: [],
    });
    expect(lateExpired.category).toBe("kedaluwarsa");
    expect(lateExpired.reasonCode).toBe("LATE_JOIN_CUTOFF_PASSED");
    expect(lateExpired.canStart).toBe(false);
  });

  it("allows resuming an active IN_PROGRESS attempt even past late-join cutoff while deadline holds", () => {
    const res = classifyStudentExamEligibility({
      examStatus: "PUBLISHED",
      publishedVersionId: "ver-1",
      hasClassSchedule: true,
      startsAtUtc: startIso,
      endsAtUtc: endIso,
      durationMinutes: 60,
      maxAttempts: 1,
      lateJoinMinutes: 15,
      nowUtcMs: startMs + 30 * 60_000,
      attempts: [
        {
          id: "att-1",
          attemptNumber: 1,
          status: "IN_PROGRESS",
          deadlineAtUtc: new Date(startMs + 65 * 60_000).toISOString(),
          submittedAtUtc: null,
        },
      ],
    });
    expect(res.category).toBe("sedang_berlangsung");
    expect(res.canResume).toBe(true);
    expect(res.activeAttemptId).toBe("att-1");
  });

  it("computes effective UTC deadline capped by schedule endsAt", () => {
    const fullDuration = computeAttemptDeadlineUtcMs({
      startedAtUtcMs: startMs,
      durationMinutes: 60,
      scheduleEndsAtUtcMs: endMs,
    });
    expect(fullDuration).toBe(startMs + 60 * 60_000);

    // Late starter 20 minutes before schedule close only gets remaining 20 mins
    const cappedByWindow = computeAttemptDeadlineUtcMs({
      startedAtUtcMs: endMs - 20 * 60_000,
      durationMinutes: 60,
      scheduleEndsAtUtcMs: endMs,
    });
    expect(cappedByWindow).toBe(endMs);

    const remaining = computeRemainingTimeMs(cappedByWindow, endMs + 10_000);
    expect(remaining.remainingMs).toBe(0);
    expect(remaining.isExpired).toBe(true);
  });

  it("produces deterministic per-attempt shuffling respecting pinned positions and canonical option maps", () => {
    const questions = [
      {
        examVersionQuestionId: "q-1",
        questionType: "single_choice" as const,
        stem: "Soal Terkunci Posisi 1",
        points: 10,
        displayOrder: 1,
        preserveOrder: true,
        preserveOptionOrder: false,
        options: [
          { optionKey: "A", optionText: "Opsi 1", displayOrder: 0 },
          { optionKey: "B", optionText: "Opsi 2", displayOrder: 1 },
          { optionKey: "C", optionText: "Opsi 3", displayOrder: 2 },
          { optionKey: "D", optionText: "Opsi 4", displayOrder: 3 },
        ],
      },
      {
        examVersionQuestionId: "q-2",
        questionType: "single_choice" as const,
        stem: "Soal Bebas A",
        points: 10,
        displayOrder: 2,
        preserveOrder: false,
        preserveOptionOrder: false,
        options: [
          { optionKey: "A", optionText: "X", displayOrder: 0 },
          { optionKey: "B", optionText: "Y", displayOrder: 1 },
          { optionKey: "C", optionText: "Z", displayOrder: 2 },
        ],
      },
      {
        examVersionQuestionId: "q-3",
        questionType: "true_false" as const,
        stem: "Benar Salah",
        points: 5,
        displayOrder: 3,
        preserveOrder: false,
        preserveOptionOrder: false,
        options: [
          { optionKey: "B", optionText: "Benar", displayOrder: 0 },
          { optionKey: "S", optionText: "Salah", displayOrder: 1 },
        ],
      },
    ];

    const run1 = buildDeterministicAttemptAssignments({
      attemptId: "attempt-abc",
      examVersionId: "ver-xyz",
      randomizeQuestions: true,
      randomizeOptions: true,
      questions,
    });
    const run2 = buildDeterministicAttemptAssignments({
      attemptId: "attempt-abc",
      examVersionId: "ver-xyz",
      randomizeQuestions: true,
      randomizeOptions: true,
      questions,
    });

    // Reload stability: identical output
    expect(run1).toEqual(run2);
    // Pinned question remains strictly index 1
    expect(run1[0]?.examVersionQuestionId).toBe("q-1");
    // Option labels shown remain orderly A, B, C, D and map bijectively back to canonical keys
    const q1Assignment = run1.find((q) => q.examVersionQuestionId === "q-1")!;
    expect(q1Assignment.optionsSnapshot.map((o) => o.optionKey)).toEqual(["A", "B", "C", "D"]);
    expect(Object.values(q1Assignment.optionOrderMap).sort()).toEqual(["A", "B", "C", "D"]);
    // True/False preserves canonical B/S order
    const q3Assignment = run1.find((q) => q.examVersionQuestionId === "q-3")!;
    expect(q3Assignment.optionsSnapshot.map((o) => o.optionKey)).toEqual(["B", "S"]);
  });
});
