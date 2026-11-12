import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentAttemptWorkspacePayload } from "@/domain/exams/phase3-types";
import {
  clearAttemptPendingDrafts,
  listPendingAnswerDrafts,
  probeExamLocalStorageHealth,
  resetMemoryDraftQueueForTests,
  upsertPendingAnswerDraft,
} from "@/lib/exam-storage";
import { ExamPlayerClient } from "@/components/features/student/exam-player-client";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
  }),
}));

function makeWorkspace(): StudentAttemptWorkspacePayload {
  const now = Date.now();
  return {
    attempt: {
      id: "att-test-1",
      schoolId: "sch-1",
      examId: "ex-1",
      examVersionId: "ver-1",
      studentId: "stu-1",
      classId: "cls-1",
      attemptNumber: 1,
      status: "IN_PROGRESS",
      startedAtUtc: new Date(now - 60_000).toISOString(),
      deadlineAtUtc: new Date(now + 45 * 60_000).toISOString(),
      submittedAtUtc: null,
      lastActivityAtUtc: new Date(now - 10_000).toISOString(),
      timeExtensionMinutes: 0,
      cancellationReason: null,
      cancelledBy: null,
      cancelledAtUtc: null,
    },
    examTitle: "Penilaian Tengah Semester",
    subjectName: "Matematika",
    instructions: "Kerjakan teliti.",
    durationMinutes: 60,
    requireExamBrowser: false,
    serverNowUtc: new Date(now).toISOString(),
    remainingMs: 45 * 60_000,
    questions: [
      {
        attemptQuestionId: "aq-1",
        displayIndex: 1,
        questionType: "single_choice",
        stem: "Berapa hasil $2 + 3$?",
        points: 10,
        options: [
          { optionKey: "A", optionText: "4", displayOrder: 0 },
          { optionKey: "B", optionText: "5", displayOrder: 1 },
        ],
        currentResponse: null,
        latestRevision: 0,
        isFlaggedForReview: false,
        committedAtUtc: null,
      },
      {
        attemptQuestionId: "aq-2",
        displayIndex: 2,
        questionType: "essay",
        stem: "Jelaskan mengapa?",
        points: 20,
        options: [],
        currentResponse: null,
        latestRevision: 0,
        isFlaggedForReview: false,
        committedAtUtc: null,
      },
    ],
  };
}

describe("Phase 3 Client Storage Queue & Honest Save Status UI", () => {
  beforeEach(() => {
    resetMemoryDraftQueueForTests();
    pushMock.mockReset();
    vi.restoreAllMocks();
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await clearAttemptPendingDrafts("att-test-1");
  });

  it("degrades gracefully with explicit warning when IndexedDB is unavailable", async () => {
    const health = await probeExamLocalStorageHealth();
    // In jsdom default IndexedDB is absent -> memory_only degradation mode with explicit warning
    expect(health.storageMode).toBe("memory_only");
    expect(health.storageOk).toBe(false);
    expect(health.warning).toMatch(/IndexedDB tidak tersedia/i);

    await upsertPendingAnswerDraft({
      attemptId: "att-test-1",
      attemptQuestionId: "aq-1",
      clientRevision: 1,
      idempotencyKey: "k-1",
      payloadHash: "h-1",
      responsePayload: { questionType: "single_choice", selectedOptionKey: "B" },
      isFlaggedForReview: false,
      updatedAtMs: Date.now(),
      attemptCount: 0,
    });
    const list = await listPendingAnswerDrafts("att-test-1");
    expect(list).toHaveLength(1);
    expect(list[0]?.clientRevision).toBe(1);
  });

  it("never displays 'Tersimpan' without DB confirmation and buffers answers cleanly when offline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("NETWORK_DOWN"));
    vi.stubGlobal("fetch", fetchMock);

    Object.defineProperty(window.navigator, "onLine", {
      value: false,
      configurable: true,
    });

    render(<ExamPlayerClient initialWorkspace={makeWorkspace()} />);

    // Select option B while offline
    const radioB = screen.getByLabelText(/B\s*5/i);
    fireEvent.click(radioB);

    // Must show Menunggu koneksi — NEVER Tersimpan
    expect(screen.getByText(/Menunggu koneksi/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Tersimpan$/)).not.toBeInTheDocument();

    // Draft is safely buffered in queue after async payload hashing completes
    await waitFor(async () => {
      const queued = await listPendingAnswerDrafts("att-test-1");
      expect(queued).toHaveLength(1);
      expect(queued[0]?.attemptQuestionId).toBe("aq-1");
    });

    // Reconnect and confirm server commit ack transitions UI cleanly to Tersimpan
    Object.defineProperty(window.navigator, "onLine", {
      value: true,
      configurable: true,
    });

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/answers")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            outcome: "COMMITTED",
            attemptId: "att-test-1",
            attemptQuestionId: "aq-1",
            authoritativeRevision: 1,
            committedAtUtc: new Date().toISOString(),
            serverNowUtc: new Date().toISOString(),
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ recorded: true }),
      } as Response;
    });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(screen.getByText(/^Tersimpan$/)).toBeInTheDocument();
    });
    const afterFlush = await listPendingAnswerDrafts("att-test-1");
    expect(afterFlush).toHaveLength(0);
  });

  it("separates question navigation from submission and routes to /review cleanly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        outcome: "COMMITTED",
        attemptId: "att-test-1",
        attemptQuestionId: "aq-1",
        authoritativeRevision: 1,
        committedAtUtc: new Date().toISOString(),
        serverNowUtc: new Date().toISOString(),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ExamPlayerClient initialWorkspace={makeWorkspace()} />);

    // Clicking Berikutnya moves to question 2 — never auto-submits
    fireEvent.click(screen.getByRole("button", { name: /Berikutnya/i }));
    await waitFor(() => {
      expect(screen.getByText(/Soal 2 dari 2/i)).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/submit"),
      expect.anything()
    );

    // Clicking Tinjau & Kumpulkan routes to dedicated review screen instead of immediate submit
    fireEvent.click(screen.getByRole("button", { name: /Tinjau & Kumpulkan/i }));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/student/attempts/att-test-1/review");
    });
  });
});
