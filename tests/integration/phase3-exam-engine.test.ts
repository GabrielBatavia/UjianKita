import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor, Phase1RoleCode } from "@/domain/auth/types";
import { GET as getStudentExams } from "@/app/api/student/exams/route";
import { POST as postStartAttempt } from "@/app/api/student/exams/[examId]/start/route";
import { PUT as putSaveAnswer } from "@/app/api/student/attempts/[attemptId]/answers/route";
import { POST as postSubmitAttempt } from "@/app/api/student/attempts/[attemptId]/submit/route";
import { GET as getStudentResults } from "@/app/api/student/results/route";
import { GET as getTeacherGradingOverview } from "@/app/api/teacher/grading/route";
import { PUT as putGradeEssay } from "@/app/api/teacher/attempts/[attemptId]/grade/route";
import { POST as postReleaseResults } from "@/app/api/teacher/exams/[id]/release/route";
import { POST as postCancelAttempt } from "@/app/api/admin/attempts/[attemptId]/cancel/route";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import * as attemptRepository from "@/repositories/attempt-repository";
import * as examRepository from "@/repositories/exam-repository";
import * as gradingRepository from "@/repositories/grading-repository";
import * as auditRepository from "@/repositories/audit-repository";
import * as questionBankService from "@/services/question-bank-service";
import * as authService from "@/services/auth-service";
import * as supabaseServer from "@/lib/supabase/server";
import {
  computeAnswerPayloadHash,
  listStudentAvailableExamsService,
  saveStudentAnswerService,
  startOrResumeStudentAttemptService,
  submitStudentAttemptService,
} from "@/services/attempt-service";
import { ServiceError } from "@/services/errors";
import {
  adjustAttemptGradeService,
  cancelAttemptByAdminService,
  gradeAttemptEssaysService,
  releaseExamResultsService,
} from "@/services/grading-service";

function makeActor(
  roles: [Phase1RoleCode, ...Phase1RoleCode[]],
  schoolId = randomUUID()
): AuthenticatedActor {
  return {
    userId: randomUUID(),
    schoolId,
    schoolName: "SMA Negeri 1 Simulasi",
    schoolCode: "SMAN1",
    schoolLevel: "SMA",
    timezone: "Asia/Jakarta",
    email: "actor@ujiankita.local",
    fullName: "Pengguna Uji Fase 3",
    roles,
    primaryRole: roles[0],
    isActive: true,
  };
}

describe("Phase 3 API Fail-Closed Authorization & Cache-Control Compliance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitForTests();
  });

  it("blocks unauthenticated callers on all student exam, autosave, submit, grading, release, and admin cancel endpoints", async () => {
    const rExams = await getStudentExams();
    expect([401, 503]).toContain(rExams.status);
    expect(rExams.headers.get("cache-control")).toContain("no-store");

    const rStart = await postStartAttempt(
      new NextRequest("http://localhost:3000/api/student/exams/e1/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ examId: "e1" }) }
    );
    expect([401, 503]).toContain(rStart.status);

    const rSave = await putSaveAnswer(
      new NextRequest("http://localhost:3000/api/student/attempts/a1/answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ attemptId: "a1" }) }
    );
    expect([401, 503]).toContain(rSave.status);

    const rSubmit = await postSubmitAttempt(
      new NextRequest("http://localhost:3000/api/student/attempts/a1/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ attemptId: "a1" }) }
    );
    expect([401, 503]).toContain(rSubmit.status);

    const rResults = await getStudentResults();
    expect([401, 503]).toContain(rResults.status);

    const rGradeOverview = await getTeacherGradingOverview();
    expect([401, 503]).toContain(rGradeOverview.status);

    const rGradeEssay = await putGradeEssay(
      new NextRequest("http://localhost:3000/api/teacher/attempts/a1/grade", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ attemptId: "a1" }) }
    );
    expect([401, 503]).toContain(rGradeEssay.status);

    const rRelease = await postReleaseResults(
      new NextRequest("http://localhost:3000/api/teacher/exams/e1/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      }),
      { params: Promise.resolve({ id: "e1" }) }
    );
    expect([401, 503]).toContain(rRelease.status);

    const rCancel = await postCancelAttempt(
      new NextRequest("http://localhost:3000/api/admin/attempts/a1/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Kendala teknis" }),
      }),
      { params: Promise.resolve({ attemptId: "a1" }) }
    );
    expect([401, 503]).toContain(rCancel.status);
  });

  it("maps SaveAckOutcome outcomes to accurate HTTP statuses (200 COMMITTED, 409 STALE, 410 EXPIRED, 403 CANCELLED)", async () => {
    const schoolId = randomUUID();
    const student = makeActor(["student"], schoolId);
    const attemptId = randomUUID();
    const aqId = randomUUID();
    const key1 = randomUUID();

    vi.spyOn(supabaseServer, "createSupabaseServerClient").mockResolvedValue(
      {} as unknown as SupabaseClient
    );
    vi.spyOn(authService, "requireRoleActor").mockResolvedValue(student);
    vi.spyOn(attemptRepository, "getActiveStudentContext").mockResolvedValue({
      studentId: randomUUID(),
      userId: student.userId,
      schoolId,
      nis: "2026001",
      classId: randomUUID(),
      className: "XII IPA 1",
    });

    const saveSpy = vi.spyOn(attemptRepository, "callSaveAnswerRpc");

    saveSpy.mockResolvedValueOnce({
      outcome: "COMMITTED",
      attemptId,
      attemptQuestionId: aqId,
      authoritativeRevision: 2,
      committedAtUtc: new Date().toISOString(),
      serverNowUtc: new Date().toISOString(),
    });
    const okRes = await putSaveAnswer(
      new NextRequest(`http://localhost:3000/api/student/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptQuestionId: aqId,
          idempotencyKey: key1,
          clientRevision: 2,
          responsePayload: { questionType: "single_choice", selectedOptionKey: "B" },
        }),
      }),
      { params: Promise.resolve({ attemptId }) }
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("cache-control")).toContain("no-store");

    saveSpy.mockResolvedValueOnce({
      outcome: "STALE_REVISION_REJECTED",
      attemptId,
      attemptQuestionId: aqId,
      authoritativeRevision: 3,
      committedAtUtc: new Date().toISOString(),
      serverNowUtc: new Date().toISOString(),
    });
    const staleRes = await putSaveAnswer(
      new NextRequest(`http://localhost:3000/api/student/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptQuestionId: aqId,
          idempotencyKey: randomUUID(),
          clientRevision: 1,
          responsePayload: { questionType: "single_choice", selectedOptionKey: "A" },
        }),
      }),
      { params: Promise.resolve({ attemptId }) }
    );
    expect(staleRes.status).toBe(409);

    saveSpy.mockResolvedValueOnce({
      outcome: "DEADLINE_EXPIRED",
      attemptId,
      attemptQuestionId: aqId,
      authoritativeRevision: 3,
      committedAtUtc: null,
      serverNowUtc: new Date().toISOString(),
    });
    const expiredRes = await putSaveAnswer(
      new NextRequest(`http://localhost:3000/api/student/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptQuestionId: aqId,
          idempotencyKey: randomUUID(),
          clientRevision: 4,
          responsePayload: { questionType: "single_choice", selectedOptionKey: "C" },
        }),
      }),
      { params: Promise.resolve({ attemptId }) }
    );
    expect(expiredRes.status).toBe(410);

    saveSpy.mockResolvedValueOnce({
      outcome: "ATTEMPT_CANCELLED",
      attemptId,
      attemptQuestionId: aqId,
      authoritativeRevision: 3,
      committedAtUtc: null,
      serverNowUtc: new Date().toISOString(),
    });
    const cancelRes = await putSaveAnswer(
      new NextRequest(`http://localhost:3000/api/student/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptQuestionId: aqId,
          idempotencyKey: randomUUID(),
          clientRevision: 4,
          responsePayload: { questionType: "single_choice", selectedOptionKey: "C" },
        }),
      }),
      { params: Promise.resolve({ attemptId }) }
    );
    expect(cancelRes.status).toBe(403);
  });
});

describe("Phase 3 Service-Boundary Logic, Eligibility, Idempotency & Audit Integrity (mocked boundary)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dummySupabase = {} as unknown as SupabaseClient;

  it("blocks non-student from calling student exam services and isolates unpublished/expired starts", async () => {
    const teacher = makeActor(["teacher"]);
    await expect(listStudentAvailableExamsService(dummySupabase, teacher)).rejects.toThrowError(
      ServiceError
    );

    const schoolId = randomUUID();
    const student = makeActor(["student"], schoolId);
    vi.spyOn(attemptRepository, "getActiveStudentContext").mockResolvedValue({
      studentId: randomUUID(),
      userId: student.userId,
      schoolId,
      nis: "2026002",
      classId: randomUUID(),
      className: "XI IPS 2",
    });

    vi.spyOn(attemptRepository, "callStartOrResumeAttemptRpc").mockRejectedValueOnce(
      new Error("LATE_JOIN_CUTOFF_PASSED")
    );

    await expect(
      startOrResumeStudentAttemptService(
        dummySupabase,
        student,
        randomUUID(),
        { startIdempotencyKey: randomUUID() },
        { ipAddress: "127.0.0.1", userAgent: "vitest" }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "LATE_JOIN_CUTOFF_PASSED",
    });
  });

  it("produces order-independent payload hashes for multiple_choice to prevent false IDEMPOTENCY_CONFLICT", async () => {
    const qId = randomUUID();
    const h1 = computeAnswerPayloadHash(qId, {
      questionType: "multiple_choice",
      selectedOptionKeys: ["C", "A"],
    });
    const h2 = computeAnswerPayloadHash(qId, {
      questionType: "multiple_choice",
      selectedOptionKeys: ["A", "C"],
    });
    expect(h1).toBe(h2);

    const hDiff = computeAnswerPayloadHash(qId, {
      questionType: "multiple_choice",
      selectedOptionKeys: ["A", "B"],
    });
    expect(hDiff).not.toBe(h1);
  });

  it("records audit events cleanly only on first commit of submit (skipping replay audit bloat)", async () => {
    const schoolId = randomUUID();
    const student = makeActor(["student"], schoolId);
    const attemptId = randomUUID();
    const examId = randomUUID();

    vi.spyOn(attemptRepository, "getActiveStudentContext").mockResolvedValue({
      studentId: randomUUID(),
      userId: student.userId,
      schoolId,
      nis: "2026003",
      classId: randomUUID(),
      className: "XII IPA 2",
    });

    const auditSpy = vi.spyOn(auditRepository, "recordAuditEvent").mockResolvedValue();
    const submitSpy = vi.spyOn(attemptRepository, "callSubmitAttemptRpc");

    submitSpy.mockResolvedValueOnce({
      idempotentReplay: false,
      receiptId: randomUUID(),
      receiptCode: "UJ-20261112-AAAA1111",
      attemptId,
      examId,
      examVersionId: randomUUID(),
      attemptStatus: "SUBMITTED",
      submittedAtUtc: new Date().toISOString(),
      answeredCount: 10,
      totalQuestions: 10,
      integrityDigest: "sha256hex",
    });

    await saveStudentAnswerService(dummySupabase, student, attemptId, {
      attemptQuestionId: randomUUID(),
      idempotencyKey: randomUUID(),
      clientRevision: 1,
      responsePayload: { questionType: "essay", textAnswer: "Jawaban" },
    }).catch(() => {});

    const first = await submitStudentAttemptService(
      dummySupabase,
      student,
      attemptId,
      { idempotencyKey: randomUUID() },
      { ipAddress: "127.0.0.1", userAgent: "vitest" }
    );
    expect(first.receiptCode).toBe("UJ-20261112-AAAA1111");
    expect(auditSpy).toHaveBeenCalledTimes(1);

    // Retry submit (idempotentReplay = true) does NOT re-emit duplicate submission audit logs
    submitSpy.mockResolvedValueOnce({
      idempotentReplay: true,
      receiptId: first.receiptId,
      receiptCode: first.receiptCode,
      attemptId,
      examId,
      examVersionId: first.examVersionId,
      attemptStatus: "SUBMITTED",
      submittedAtUtc: first.submittedAtUtc,
      answeredCount: 10,
      totalQuestions: 10,
      integrityDigest: first.integrityDigest,
    });

    const second = await submitStudentAttemptService(
      dummySupabase,
      student,
      attemptId,
      { idempotencyKey: randomUUID() },
      { ipAddress: "127.0.0.1", userAgent: "vitest" }
    );
    expect(second.receiptCode).toBe(first.receiptCode);
    expect(auditSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces subject ownership, mandatory adjustment reason, and admin-only attempt cancellation", async () => {
    const schoolId = randomUUID();
    const examId = randomUUID();
    const attemptId = randomUUID();
    const teacher = makeActor(["teacher"], schoolId);
    const admin = makeActor(["admin"], schoolId);
    const otherSubjectId = randomUUID();
    const ownedSubjectId = randomUUID();

    vi.spyOn(examRepository, "fetchExamDetail").mockResolvedValue({
      exam: {
        id: examId,
        school_id: schoolId,
        subject_id: otherSubjectId,
        academic_year_id: randomUUID(),
        created_by: teacher.userId,
        title: "UAS Kimia",
        description: null,
        instructions: null,
        status: "PUBLISHED",
        duration_minutes: 60,
        max_attempts: 1,
        passing_score: 75,
        randomize_questions: false,
        randomize_options: false,
        starts_at: null,
        ends_at: null,
        published_version_id: randomUUID(),
        version_lock: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      draftQuestions: [],
      assignments: [],
      schedules: [],
      publishedVersions: [],
      publicationEvents: [],
    });

    vi.spyOn(gradingRepository, "fetchTeacherAttemptDetail").mockResolvedValue({
      summary: {
        attemptId,
        examId,
        studentId: randomUUID(),
        studentUserId: randomUUID(),
        studentName: "Siti Aminah",
        studentNis: "1001",
        className: "XII IPA 1",
        attemptNumber: 1,
        status: "SUBMITTED",
        startedAtUtc: new Date().toISOString(),
        deadlineAtUtc: new Date().toISOString(),
        submittedAtUtc: new Date().toISOString(),
        receiptCode: "UJ-20261112-BBBB2222",
        answeredCount: 2,
        totalQuestions: 2,
        gradingStatus: "PENDING_MANUAL_REVIEW",
        releaseStatus: "UNRELEASED",
        objectiveScore: 50,
        manualScore: 0,
        adjustmentDelta: 0,
        totalScore: 50,
        maxScore: 100,
        percentageScore: 50,
        passed: false,
        pendingEssayCount: 1,
      },
      examTitle: "UAS Kimia",
      subjectName: "Kimia",
      passingScore: 75,
      questions: [],
      adjustments: [],
      events: [],
    });

    // Teacher teaching Physics cannot grade Chemistry exam
    vi.spyOn(questionBankService, "getAuthorizedSubjectIdsForActor").mockResolvedValue([
      { id: ownedSubjectId, code: "FIS", name: "Fisika" },
    ]);

    await expect(
      gradeAttemptEssaysService(
        dummySupabase,
        teacher,
        attemptId,
        {
          entries: [
            { examVersionQuestionId: randomUUID(), assignedScore: 40, feedback: "Bagus" },
          ],
        },
        { ipAddress: "127.0.0.1", userAgent: "vitest" }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SUBJECT_FORBIDDEN",
    });

    // Teacher cannot cancel active attempt — Admin only
    await expect(
      cancelAttemptByAdminService(
        dummySupabase,
        teacher,
        attemptId,
        { reason: "Kendala listrik" },
        { ipAddress: "127.0.0.1", userAgent: "vitest" }
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    // Grade adjustment requires >= 5 character audit reason
    await expect(
      adjustAttemptGradeService(
        dummySupabase,
        admin,
        attemptId,
        { newTotalScore: 80, reason: "ok" },
        { ipAddress: "127.0.0.1", userAgent: "vitest" }
      )
    ).rejects.toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });

    const auditSpy = vi.spyOn(auditRepository, "recordAuditEvent").mockResolvedValue();
    vi.spyOn(gradingRepository, "callAdjustGradeRpc").mockResolvedValue({
      attemptId,
      gradingStatus: "ADJUSTED",
      previousTotalScore: 50,
      totalScore: 80,
      percentageScore: 80,
      passed: true,
    });
    vi.spyOn(gradingRepository, "callReleaseResultsRpc").mockResolvedValue({
      examId,
      action: "release",
      releasedCount: 1,
      pendingManualCount: 0,
      resultsReleasedAt: new Date().toISOString(),
    });
    vi.spyOn(gradingRepository, "callCancelAttemptByAdminRpc").mockResolvedValue({
      attemptId,
      status: "CANCELLED_BY_ADMIN",
      cancelledAtUtc: new Date().toISOString(),
    });

    const adjResult = await adjustAttemptGradeService(
      dummySupabase,
      admin,
      attemptId,
      { newTotalScore: 80, reason: "Ralat bobot soal nomor 2 sesuai rapat MGMP." },
      { ipAddress: "127.0.0.1", userAgent: "vitest" }
    );
    expect(adjResult.gradingStatus).toBe("ADJUSTED");
    expect(auditSpy).toHaveBeenCalledWith(
      dummySupabase,
      expect.objectContaining({ action: "grading.adjusted" })
    );

    await releaseExamResultsService(
      dummySupabase,
      admin,
      examId,
      { action: "release" },
      { ipAddress: "127.0.0.1", userAgent: "vitest" }
    );
    expect(auditSpy).toHaveBeenCalledWith(
      dummySupabase,
      expect.objectContaining({ action: "results.released" })
    );

    await cancelAttemptByAdminService(
      dummySupabase,
      admin,
      attemptId,
      { reason: "Perangkat siswa mati total di lab 2 dan dijadwal ulang." },
      { ipAddress: "127.0.0.1", userAgent: "vitest" }
    );
    expect(auditSpy).toHaveBeenCalledWith(
      dummySupabase,
      expect.objectContaining({ action: "attempt.cancelled" })
    );
  });
});

// Live Supabase PostgreSQL Phase 3 transactional RPC & RLS suite
const liveUrl = process.env.TEST_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY;
const liveService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(liveUrl && liveAnon && liveService);

describe.skipIf(!hasLiveSupabase)(
  "Live Supabase Phase 3 Atomic Exam Attempts, Option Order Mapping, Grading & RLS",
  () => {
    it("enforces atomic single active attempt, monotonic revision saves, canonical key scoring, manual essay review & release RLS", async () => {
      const service = createClient(liveUrl!, liveService!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const suffix = randomUUID().slice(0, 8);
      const schoolId = randomUUID();
      const yearId = randomUUID();
      const subjectId = randomUUID();
      const classId = randomUUID();
      const bankId = randomUUID();
      const credential = randomUUID();
      const createdUsers: string[] = [];

      async function createTestUser(roleCode: "teacher" | "student", label: string) {
        const email = `p3-${label}-${suffix}@ujiankita.local`;
        const { data: uData, error: uErr } = await service.auth.admin.createUser({
          email,
          password: credential,
          email_confirm: true,
        });
        if (uErr || !uData.user) throw new Error(uErr?.message);
        createdUsers.push(uData.user.id);

        await service.from("user_profiles").insert({
          id: uData.user.id,
          school_id: schoolId,
          full_name: `Test ${label}`,
          email,
        });

        const { data: rRow } = await service
          .from("roles")
          .select("id")
          .eq("code", roleCode)
          .single();
        await service.from("user_roles").insert({
          user_id: uData.user.id,
          role_id: rRow!.id,
        });
        return { userId: uData.user.id, email };
      }

      try {
        await service.from("schools").insert({
          id: schoolId,
          code: `P3_${suffix}`,
          name: `SMA Phase 3 ${suffix}`,
          level: "SMA",
        });
        await service.from("academic_years").insert({
          id: yearId,
          school_id: schoolId,
          name: "2026/2027",
          semester: "Ganjil",
          starts_on: "2026-07-01",
          ends_on: "2026-12-31",
          is_active: true,
        });
        await service.from("subjects").insert({
          id: subjectId,
          school_id: schoolId,
          code: `FIS-${suffix}`,
          name: "Fisika",
        });
        await service.from("classes").insert({
          id: classId,
          school_id: schoolId,
          academic_year_id: yearId,
          name: "XII IPA P3",
          grade_level: "XII",
        });

        const teacherUser = await createTestUser("teacher", "teacher");
        const studentUser = await createTestUser("student", "student");

        const { data: teacherRow } = await service
          .from("teachers")
          .insert({
            user_id: teacherUser.userId,
            school_id: schoolId,
            nip: `T-${suffix}`,
          })
          .select("id")
          .single();
        await service.from("teacher_assignments").insert({
          school_id: schoolId,
          teacher_id: teacherRow!.id,
          class_id: classId,
          subject_id: subjectId,
          academic_year_id: yearId,
        });

        const { data: studentRow } = await service
          .from("students")
          .insert({
            user_id: studentUser.userId,
            school_id: schoolId,
            nis: `S-${suffix}`,
          })
          .select("id")
          .single();
        await service.from("class_enrollments").insert({
          school_id: schoolId,
          class_id: classId,
          student_id: studentRow!.id,
          academic_year_id: yearId,
          status: "active",
        });

        await service.from("question_banks").insert({
          id: bankId,
          school_id: schoolId,
          subject_id: subjectId,
          created_by: teacherUser.userId,
          title: "Bank Uji Fase 3",
        });

        const teacherClient = createClient(liveUrl!, liveAnon!);
        await teacherClient.auth.signInWithPassword({
          email: teacherUser.email,
          password: credential,
        });

        // Create 1 MCQ (20 pts) + 1 Essay (30 pts) & publish exam
        const qMcq = await teacherClient.rpc("create_question_with_version", {
          p_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "single_choice",
          p_difficulty: "easy",
          p_topic: "Kinematika",
          p_tags: [],
          p_stem: "Satuan SI kecepatan adalah?",
          p_explanation: "RAHASIA_PENJELASAN",
          p_points: 20,
          p_scoring_policy: "exact_match",
          p_rubric_notes: "RAHASIA_RUBRIK",
          p_preserve_option_order: false,
          p_options: [
            { optionKey: "A", optionText: "m/s", displayOrder: 0 },
            { optionKey: "B", optionText: "km/jam", displayOrder: 1 },
          ],
          p_correct_option_keys: ["A"],
        });

        const qEssay = await teacherClient.rpc("create_question_with_version", {
          p_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "essay",
          p_difficulty: "medium",
          p_topic: "Hukum Newton",
          p_tags: [],
          p_stem: "Jelaskan Hukum I Newton.",
          p_explanation: null,
          p_points: 30,
          p_scoring_policy: "manual_rubric",
          p_rubric_notes: "Sebutkan kelembaman",
          p_preserve_option_order: true,
          p_options: [],
          p_correct_option_keys: [],
        });

        const nowMs = Date.now();
        const { data: examRow } = await teacherClient
          .from("exams")
          .insert({
            school_id: schoolId,
            subject_id: subjectId,
            academic_year_id: yearId,
            created_by: teacherUser.userId,
            title: `Ujian Fase 3 Live ${suffix}`,
            status: "DRAFT",
            duration_minutes: 60,
            max_attempts: 1,
            passing_score: 70,
            randomize_questions: true,
            randomize_options: true,
            result_release_policy: "manual",
            starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
            ends_at: new Date(nowMs + 55 * 60_000).toISOString(),
          })
          .select("id")
          .single();

        await teacherClient.from("exam_draft_questions").insert([
          { school_id: schoolId, exam_id: examRow!.id, question_id: qMcq.data.questionId, display_order: 1 },
          { school_id: schoolId, exam_id: examRow!.id, question_id: qEssay.data.questionId, display_order: 2 },
        ]);
        await teacherClient.from("exam_assignments").insert({
          school_id: schoolId,
          exam_id: examRow!.id,
          class_id: classId,
          assigned_by: teacherUser.userId,
        });
        await teacherClient.from("exam_schedules").insert({
          school_id: schoolId,
          exam_id: examRow!.id,
          class_id: classId,
          starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
          ends_at: new Date(nowMs + 55 * 60_000).toISOString(),
          duration_minutes: 60,
          max_attempts: 1,
          late_join_minutes: 30,
        });
        await teacherClient.rpc("publish_exam_atomic", {
          p_exam_id: examRow!.id,
          p_expected_version_lock: 1,
          p_notes: "Live P3 test",
        });

        const studentClient = createClient(liveUrl!, liveAnon!);
        await studentClient.auth.signInWithPassword({
          email: studentUser.email,
          password: credential,
        });

        // Verify RLS denies direct read of exam_version_questions & exam_version_answer_keys
        const { data: leakedKeys } = await studentClient
          .from("exam_version_answer_keys")
          .select("id");
        expect(leakedKeys ?? []).toHaveLength(0);
        const { data: leakedEvq } = await studentClient
          .from("exam_version_questions")
          .select("id");
        expect(leakedEvq ?? []).toHaveLength(0);

        // Concurrent dual start calls yield ONE single attemptId
        const [startA, startB] = await Promise.all([
          studentClient.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examRow!.id,
            p_start_idempotency_key: randomUUID(),
          }),
          studentClient.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examRow!.id,
            p_start_idempotency_key: randomUUID(),
          }),
        ]);
        expect(startA.error).toBeNull();
        expect(startB.error).toBeNull();
        expect(startA.data.attemptId).toBe(startB.data.attemptId);

        const attemptId = startA.data.attemptId as string;
        const { data: assignedQs } = await studentClient
          .from("attempt_question_assignments")
          .select("*")
          .eq("attempt_id", attemptId)
          .order("display_index", { ascending: true });
        expect(assignedQs).toHaveLength(2);

        const mcqQa = assignedQs!.find((q) => q.question_type === "single_choice")!;
        const essayQa = assignedQs!.find((q) => q.question_type === "essay")!;
        // Find displayed key corresponding to canonical option "A" ("m/s")
        const displayKeyForCanonicalA = Object.entries(
          mcqQa.option_order_map as Record<string, string>
        ).find(([, canonical]) => canonical === "A")![0];

        const idemKey1 = randomUUID();
        const saveRev2 = await studentClient.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: mcqQa.id,
          p_idempotency_key: idemKey1,
          p_client_revision: 2,
          p_response_payload: {
            questionType: "single_choice",
            selectedOptionKey: displayKeyForCanonicalA,
          },
          p_payload_hash: "h2",
        });
        expect(saveRev2.data.outcome).toBe("COMMITTED");

        // Stale revision 1 rejected cleanly
        const saveStale = await studentClient.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: mcqQa.id,
          p_idempotency_key: randomUUID(),
          p_client_revision: 1,
          p_response_payload: {
            questionType: "single_choice",
            selectedOptionKey: "B",
          },
          p_payload_hash: "h1",
        });
        expect(saveStale.data.outcome).toBe("STALE_REVISION_REJECTED");

        // Idempotent replay with same key & hash returns IDEMPOTENT_REPLAY
        const replay = await studentClient.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: mcqQa.id,
          p_idempotency_key: idemKey1,
          p_client_revision: 2,
          p_response_payload: {
            questionType: "single_choice",
            selectedOptionKey: displayKeyForCanonicalA,
          },
          p_payload_hash: "h2",
        });
        expect(replay.data.outcome).toBe("IDEMPOTENT_REPLAY");

        // Save essay & submit atomically twice
        await studentClient.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: essayQa.id,
          p_idempotency_key: randomUUID(),
          p_client_revision: 1,
          p_response_payload: {
            questionType: "essay",
            textAnswer: "Benda diam tetap diam kecuali ada gaya.",
          },
          p_payload_hash: "he1",
        });

        const [sub1, sub2] = await Promise.all([
          studentClient.rpc("submit_exam_attempt_atomic", {
            p_attempt_id: attemptId,
            p_idempotency_key: randomUUID(),
          }),
          studentClient.rpc("submit_exam_attempt_atomic", {
            p_attempt_id: attemptId,
            p_idempotency_key: randomUUID(),
          }),
        ]);
        expect(sub1.data.receiptCode).toBe(sub2.data.receiptCode);

        // Student RLS cannot read unreleased/pending manual review grade
        const { data: hiddenGrades } = await studentClient
          .from("exam_grades")
          .select("*")
          .eq("attempt_id", attemptId);
        expect(hiddenGrades ?? []).toHaveLength(0);

        // Teacher scores essay 25/30 and releases
        const graded = await teacherClient.rpc("grade_essay_and_recalculate_atomic", {
          p_attempt_id: attemptId,
          p_entries: [
            {
              examVersionQuestionId: essayQa.exam_version_question_id,
              assignedScore: 25,
              feedback: "Tepat sekali",
            },
          ],
          p_release_if_complete: true,
        });
        expect(graded.data.objectiveScore).toBe(20);
        expect(graded.data.manualScore).toBe(25);
        expect(graded.data.totalScore).toBe(45);
        expect(graded.data.releaseStatus).toBe("RELEASED");

        const { data: visibleGrades } = await studentClient
          .from("exam_grades")
          .select("*")
          .eq("attempt_id", attemptId);
        expect(visibleGrades).toHaveLength(1);
        expect(Number(visibleGrades![0].total_score)).toBe(45);
      } finally {
        for (const uid of createdUsers) {
          await service.auth.admin.deleteUser(uid);
        }
        await service.from("schools").delete().eq("id", schoolId);
      }
    }, 30_000);
  }
);
