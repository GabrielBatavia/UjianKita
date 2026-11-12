// @vitest-environment jsdom
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentExamWatermark } from "@/components/features/student/student-exam-watermark";
import { StudentExamSecurityCard } from "@/components/features/student/student-exam-security-card";
import { ExamPlayerClient } from "@/components/features/student/exam-player-client";
import type { StudentAttemptWorkspacePayload } from "@/domain/exams/phase3-types";
import type { StudentSecurityPolicyView } from "@/domain/monitoring/phase4-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("Phase 4 Student Watermark, Security Card & Scoped Guards", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      })
    );
  });

  it("renders accessible non-interactive watermark with clamped opacity", () => {
    const { container } = render(
      <StudentExamWatermark
        enabled
        opacity={0.9}
        studentName="Siti Aminah"
        attemptId="abcdef12-3456-7890-1234-567890abcdef"
      />
    );
    const wm = screen.getByTestId("student-exam-watermark");
    expect(wm.getAttribute("aria-hidden")).toBe("true");
    expect(wm.className).toContain("pointer-events-none");
    expect(wm.style.opacity).toBe("0.18");
    expect(container.textContent).toContain("Siti Aminah");
    expect(container.textContent).toContain("ABCDEF12");
  });

  it("displays privacy disclosure, ExamBro QR, and SEB download controls honestly", () => {
    const policy: StudentSecurityPolicyView = {
      examId: "exam-1",
      examTitle: "Ujian Akhir IPA",
      browserPolicy: "SECURE_BROWSER_RECOMMENDED",
      exambroEnabled: true,
      exambroMinAppHint: null,
      sebEnabled: true,
      sebJsApiVerificationRequired: false,
      sebVerifiedForAttempt: false,
      hasActiveStaffOverride: false,
      overrideReason: null,
      copyPasteGuardEnabled: true,
      contextMenuGuardEnabled: true,
      watermarkEnabled: true,
      watermarkOpacity: 0.08,
      heartbeatIntervalSeconds: 30,
      privacyNoticeText:
        "Selama ujian berlangsung, UjianKita mencatat sinyal teknis konektivitas.",
      sebConfigDownloadUrl: "/api/student/exams/exam-1/seb-config",
      sebLaunchUrl: "sebs://localhost:3000/api/student/exams/exam-1/seb-config",
    };

    render(
      <StudentExamSecurityCard
        policy={policy}
        sebStatus={{ apiDetected: false, verified: false, detail: null }}
        onRetrySebVerify={vi.fn()}
        verifyingSeb={false}
      />
    );

    expect(screen.getByText(/Selama ujian berlangsung/i)).toBeTruthy();
    expect(screen.getByText(/Petunjuk Klien \(Non-Kriptografis\)/i)).toBeTruthy();
    expect(screen.getByText(/Unduh Konfigurasi \(\.seb\)/i)).toBeTruthy();
  });

  it("scopes copy/context-menu guard to prompt area without blocking essay typing or submission button", () => {
    const workspace: StudentAttemptWorkspacePayload = {
      examTitle: "Ujian Esai Bahasa Indonesia",
      subjectName: "Bahasa Indonesia",
      instructions: null,
      durationMinutes: 60,
      requireExamBrowser: false,
      serverNowUtc: "2026-11-12T08:00:00.000Z",
      remainingMs: 3600_000,
      attempt: {
        id: "att-1",
        schoolId: "sch-1",
        examId: "exam-1",
        examVersionId: "ev-1",
        studentId: "st-1",
        classId: "cls-1",
        attemptNumber: 1,
        status: "IN_PROGRESS",
        startedAtUtc: "2026-11-12T07:55:00.000Z",
        deadlineAtUtc: "2026-11-12T09:00:00.000Z",
        submittedAtUtc: null,
        lastActivityAtUtc: "2026-11-12T07:59:00.000Z",
        timeExtensionMinutes: 0,
        cancellationReason: null,
        cancelledBy: null,
        cancelledAtUtc: null,
      },
      questions: [
        {
          attemptQuestionId: "aq-1",
          displayIndex: 1,
          questionType: "essay",
          stem: "Jelaskan proses fotosintesis pada tumbuhan hijau.",
          points: 10,
          options: [],
          isFlaggedForReview: false,
          currentResponse: { questionType: "essay", textAnswer: "" },
          latestRevision: 0,
          committedAtUtc: null,
        },
      ],
    };

    const { container } = render(
      <ExamPlayerClient
        initialWorkspace={workspace}
        studentDisplayName="Budi Santoso"
        securityPolicy={{
          examId: "exam-1",
          examTitle: workspace.examTitle,
          browserPolicy: "STANDARD_BROWSER_ALLOWED",
          exambroEnabled: false,
          exambroMinAppHint: null,
          sebEnabled: false,
          sebJsApiVerificationRequired: false,
          sebVerifiedForAttempt: false,
          hasActiveStaffOverride: false,
          overrideReason: null,
          copyPasteGuardEnabled: true,
          contextMenuGuardEnabled: true,
          watermarkEnabled: true,
          watermarkOpacity: 0.08,
          heartbeatIntervalSeconds: 30,
          privacyNoticeText: "Privacy",
          sebConfigDownloadUrl: "",
          sebLaunchUrl: "",
        }}
      />
    );

    const promptDiv = container.querySelector('[data-exam-prompt="true"]');
    expect(promptDiv).toBeTruthy();
    const copyEvt = new Event("copy", { bubbles: true, cancelable: true });
    promptDiv?.dispatchEvent(copyEvt);
    expect(copyEvt.defaultPrevented).toBe(true);

    // Essay textarea remains completely usable and paste/type enabled
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Fotosintesis mengubah energi cahaya menjadi glukosa." },
    });
    expect((textarea as HTMLTextAreaElement).value).toContain("glukosa");

    // Submit navigation button remains clickable/accessible
    expect(screen.getByRole("button", { name: /Tinjau & Kumpulkan/i })).toBeTruthy();
  });
});
