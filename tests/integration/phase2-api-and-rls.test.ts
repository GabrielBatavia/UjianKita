import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { AuthenticatedActor, Phase1RoleCode } from "@/domain/auth/types";
import { GET as getTeacherQuestions, POST as postTeacherQuestion } from "@/app/api/teacher/questions/route";
import { GET as getTeacherExams, POST as postTeacherExam } from "@/app/api/teacher/exams/route";
import { POST as postPublishExam } from "@/app/api/teacher/exams/[id]/publish/route";
import { GET as getExamPreview } from "@/app/api/teacher/exams/[id]/preview/route";
import { GET as getAdminExams } from "@/app/api/admin/exams/route";
import * as examRepository from "@/repositories/exam-repository";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { ServiceError } from "@/services/errors";
import { createQuestionService, listQuestionsService } from "@/services/question-bank-service";
import {
  createExamService,
  getExamPreviewService,
  publishExamService,
  updateExamDraftQuestionsService,
  updateExamScheduleService,
  validateExamForReviewService,
} from "@/services/exam-service";

describe("Phase 2 API Route Handler Authorization & Security Projection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitForTests();
  });

  it("blocks unauthenticated callers on all Phase 2 question, exam, publish, preview, and admin oversight routes", async () => {
    const qGet = await getTeacherQuestions(new NextRequest("http://localhost:3000/api/teacher/questions"));
    expect([401, 503]).toContain(qGet.status);

    const qPost = await postTeacherQuestion(
      new NextRequest("http://localhost:3000/api/teacher/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect([401, 503]).toContain(qPost.status);

    const eGet = await getTeacherExams(new NextRequest("http://localhost:3000/api/teacher/exams"));
    expect([401, 503]).toContain(eGet.status);

    const ePost = await postTeacherExam(
      new NextRequest("http://localhost:3000/api/teacher/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect([401, 503]).toContain(ePost.status);

    const pubPost = await postPublishExam(
      new NextRequest("http://localhost:3000/api/teacher/exams/exam-1/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionLock: 1 }),
      }),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect([401, 503]).toContain(pubPost.status);

    const prevGet = await getExamPreview(
      new NextRequest("http://localhost:3000/api/teacher/exams/exam-1/preview?mode=student"),
      { params: Promise.resolve({ id: "exam-1" }) }
    );
    expect([401, 503]).toContain(prevGet.status);

    const adminGet = await getAdminExams(new NextRequest("http://localhost:3000/api/admin/exams"));
    expect([401, 503]).toContain(adminGet.status);
  });
});

// Service-boundary tests with mocked Supabase client (verifies authorization, concurrency conflict, and student preview isolation offline)
describe("Phase 2 Service-Boundary Authorization, Concurrency & Student-Safe Projection (mocked boundary)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeActor(
    roles: [Phase1RoleCode, ...Phase1RoleCode[]],
    schoolId: string
  ): AuthenticatedActor {
    return {
      userId: randomUUID(),
      schoolId,
      schoolName: "SMA Negeri Mock",
      schoolCode: "MOCK01",
      schoolLevel: "SMA",
      timezone: "Asia/Jakarta",
      email: "actor@ujiankita.local",
      fullName: "Pengguna Uji",
      roles,
      primaryRole: roles[0]!,
      isActive: true,
    };
  }

  function createQueryChain(result: { data: unknown; error: { message: string } | null }) {
    const chain = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      single: vi.fn(async () =>
        Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result
      ),
      maybeSingle: vi.fn(async () => result),
      then: (
        onFulfilled?: (v: { data: unknown; error: { message: string } | null }) => unknown,
        onRejected?: (r: unknown) => unknown
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return chain;
  }

  it("rejects student actors with 403 FORBIDDEN on bank soal and exam mutations", async () => {
    const schoolId = randomUUID();
    const student = makeActor(["student"], schoolId);
    const dummySupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(listQuestionsService(dummySupabase, student, {})).rejects.toSatisfy(
      (err: unknown) => err instanceof ServiceError && err.statusCode === 403 && err.code === "FORBIDDEN"
    );

    await expect(createQuestionService(dummySupabase, student, {})).rejects.toSatisfy(
      (err: unknown) => err instanceof ServiceError && err.statusCode === 403 && err.code === "FORBIDDEN"
    );

    await expect(createExamService(dummySupabase, student, {}, { ipAddress: null, userAgent: null })).rejects.toSatisfy(
      (err: unknown) => err instanceof ServiceError && err.statusCode === 403 && err.code === "FORBIDDEN"
    );

    await expect(publishExamService(dummySupabase, student, randomUUID(), { versionLock: 1 })).rejects.toSatisfy(
      (err: unknown) => err instanceof ServiceError && err.statusCode === 403 && err.code === "FORBIDDEN"
    );
  });

  it("blocks teacher access to unassigned subjects or classes (SUBJECT_FORBIDDEN / CLASS_FORBIDDEN)", async () => {
    const schoolId = randomUUID();
    const teacher = makeActor(["teacher"], schoolId);
    const allowedSubjectId = randomUUID();
    const unauthorizedSubjectId = randomUUID();
    const allowedClassId = randomUUID();
    const unauthorizedClassId = randomUUID();
    const academicYearId = randomUUID();

    const teacherSupabase = {
      from: vi.fn((table: string) => {
        if (table === "teachers") {
          return createQueryChain({ data: { id: randomUUID() }, error: null });
        }
        if (table === "teacher_assignments") {
          return createQueryChain({
            data: [
              {
                subject: { id: allowedSubjectId, code: "MAT", name: "Matematika", is_active: true },
                class: {
                  id: allowedClassId,
                  name: "X IPA 1",
                  grade_level: "10",
                  academic_year_id: academicYearId,
                  is_active: true,
                },
              },
            ],
            error: null,
          });
        }
        if (table === "classes") {
          return createQueryChain({ data: [], error: null });
        }
        return createQueryChain({ data: null, error: null });
      }),
    } as unknown as SupabaseClient;

    await expect(
      createQuestionService(teacherSupabase, teacher, {
        subjectId: unauthorizedSubjectId,
        questionType: "single_choice",
        difficulty: "easy",
        points: 10,
        scoringPolicy: "exact_match",
        stem: "Soal lintas mata pelajaran yang tidak ditugaskan",
        options: [
          { optionKey: "A", optionText: "Benar", displayOrder: 0 },
          { optionKey: "B", optionText: "Salah", displayOrder: 1 },
        ],
        correctOptionKeys: ["A"],
        status: "active",
      })
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ServiceError && err.statusCode === 403 && err.code === "SUBJECT_FORBIDDEN"
    );

    await expect(
      createExamService(
        teacherSupabase,
        teacher,
        {
          subjectId: allowedSubjectId,
          academicYearId,
          title: "Ujian Lintas Kelas Tidak Sah",
          durationMinutes: 60,
          maxAttempts: 1,
          passingScore: 70,
          randomizeQuestions: true,
          randomizeOptions: true,
          classIds: [unauthorizedClassId],
        },
        { ipAddress: null, userAgent: null }
      )
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ServiceError && err.statusCode === 403 && err.code === "CLASS_FORBIDDEN"
    );

    const examId = randomUUID();
    vi.spyOn(examRepository, "fetchExamDetail").mockResolvedValue({
      exam: {
        id: examId,
        school_id: schoolId,
        subject_id: allowedSubjectId,
        academic_year_id: academicYearId,
        created_by: teacher.userId,
        title: "Ujian Matematika",
        description: null,
        instructions: null,
        status: "DRAFT",
        duration_minutes: 60,
        max_attempts: 1,
        passing_score: 70,
        randomize_questions: false,
        randomize_options: false,
        starts_at: null,
        ends_at: null,
        published_version_id: null,
        version_lock: 1,
        created_at: "2026-11-12T00:00:00.000Z",
        updated_at: "2026-11-12T00:00:00.000Z",
      },
      draftQuestions: [],
      assignments: [],
      schedules: [],
      publishedVersions: [],
      publicationEvents: [],
    });

    await expect(
      updateExamScheduleService(
        teacherSupabase,
        teacher,
        examId,
        {
          versionLock: 1,
          startsAt: "2026-12-10T08:00:00.000Z",
          endsAt: "2026-12-10T10:00:00.000Z",
          durationMinutes: 60,
          maxAttempts: 1,
          lateJoinMinutes: 10,
          requireExamBrowser: true,
          classIds: [allowedClassId, unauthorizedClassId],
        },
        { ipAddress: null, userAgent: null }
      )
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ServiceError && err.statusCode === 403 && err.code === "CLASS_FORBIDDEN"
    );
  });

  it("throws 409 CONCURRENCY_CONFLICT when optimistic version_lock is stale", async () => {
    const schoolId = randomUUID();
    const admin = makeActor(["admin"], schoolId);
    const examId = randomUUID();
    const subjectId = randomUUID();
    const qId = randomUUID();

    vi.spyOn(examRepository, "fetchExamDetail").mockResolvedValue({
      exam: {
        id: examId,
        school_id: schoolId,
        subject_id: subjectId,
        academic_year_id: randomUUID(),
        created_by: admin.userId,
        title: "PTS Fisika",
        description: null,
        instructions: "Kerjakan teliti.",
        status: "DRAFT",
        duration_minutes: 60,
        max_attempts: 1,
        passing_score: 70,
        randomize_questions: true,
        randomize_options: false,
        starts_at: "2026-11-25T08:00:00.000Z",
        ends_at: "2026-11-25T10:00:00.000Z",
        published_version_id: null,
        version_lock: 3,
        created_at: "2026-11-12T00:00:00.000Z",
        updated_at: "2026-11-12T00:00:00.000Z",
      },
      draftQuestions: [
        {
          id: randomUUID(),
          exam_id: examId,
          question_id: qId,
          display_order: 1,
          points_override: null,
          preserve_order: false,
          question: {
            id: qId,
            school_id: schoolId,
            question_bank_id: randomUUID(),
            subject_id: subjectId,
            created_by: admin.userId,
            current_version_id: randomUUID(),
            question_type: "single_choice",
            difficulty: "medium",
            topic: "Kinematika",
            tags: [],
            status: "active",
            attachment_metadata: [],
            content_fingerprint: "fp-1",
            created_at: "2026-11-12T00:00:00.000Z",
            updated_at: "2026-11-12T00:00:00.000Z",
            current_version: {
              id: randomUUID(),
              question_id: qId,
              version_number: 1,
              stem: "Berapakah percepatan gravitasi standar di bumi?",
              explanation: "Rahasia pembahasan",
              points: 100,
              scoring_policy: "exact_match",
              rubric_notes: "Rahasia rubrik",
              preserve_option_order: false,
              created_by: admin.userId,
              created_at: "2026-11-12T00:00:00.000Z",
              options: [
                { optionKey: "A", optionText: "9,8 m/s^2", displayOrder: 0 },
                { optionKey: "B", optionText: "3,2 m/s^2", displayOrder: 1 },
              ],
              correct_option_keys: ["A"],
            },
          },
        },
      ],
      assignments: [
        {
          id: randomUUID(),
          exam_id: examId,
          class_id: randomUUID(),
          class_name: "X IPA 1",
          grade_level: "10",
          student_count: 30,
        },
      ],
      schedules: [],
      publishedVersions: [],
      publicationEvents: [],
    });

    const conflictSupabase = {
      from: vi.fn((table: string) => {
        if (table === "questions") {
          return createQueryChain({
            data: [{ id: qId, subject_id: subjectId, status: "active", current_version_id: randomUUID() }],
            error: null,
          });
        }
        // Returning null on update().eq("version_lock", staleLock).maybeSingle() triggers CONCURRENCY_CONFLICT
        return createQueryChain({ data: null, error: null });
      }),
    } as unknown as SupabaseClient;

    await expect(
      updateExamDraftQuestionsService(
        conflictSupabase,
        admin,
        examId,
        {
          versionLock: 2,
          items: [{ questionId: qId, pointsOverride: null, preserveOrder: false }],
        },
        { ipAddress: null, userAgent: null }
      )
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ServiceError &&
        err.statusCode === 409 &&
        err.code === "CONCURRENCY_CONFLICT"
    );

    await expect(
      validateExamForReviewService(conflictSupabase, admin, examId, 2, {
        ipAddress: null,
        userAgent: null,
      })
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ServiceError &&
        err.statusCode === 409 &&
        err.code === "CONCURRENCY_CONFLICT"
    );
  });

  it("strips answer keys, explanations, rubrics, and avoids querying exam_version_answer_keys in student preview", async () => {
    const schoolId = randomUUID();
    const admin = makeActor(["admin"], schoolId);
    const examId = randomUUID();
    const publishedVersionId = randomUUID();
    const subjectId = randomUUID();
    const qId = randomUUID();
    const queriedTables: string[] = [];

    const secretExplanation = "SECRET_EXPLANATION_DO_NOT_LEAK";
    const secretRubric = "SECRET_RUBRIC_DO_NOT_LEAK";
    let examStatus: "PUBLISHED" | "DRAFT" = "PUBLISHED";
    let activePublishedVersionId: string | null = publishedVersionId;

    const previewSupabase = {
      from: vi.fn((table: string) => {
        queriedTables.push(table);
        if (table === "exams") {
          return createQueryChain({
            data: {
              id: examId,
              school_id: schoolId,
              subject_id: subjectId,
              subject: { code: "MAT", name: "Matematika" },
              academic_year_id: randomUUID(),
              created_by: admin.userId,
              title: "UAS Matematika",
              description: null,
              instructions: "Pilih jawaban paling tepat.",
              status: examStatus,
              duration_minutes: 90,
              max_attempts: 1,
              passing_score: 75,
              randomize_questions: true,
              randomize_options: true,
              starts_at: "2026-12-01T08:00:00.000Z",
              ends_at: "2026-12-01T10:00:00.000Z",
              published_version_id: activePublishedVersionId,
              version_lock: 2,
              created_at: "2026-11-12T00:00:00.000Z",
              updated_at: "2026-11-12T00:00:00.000Z",
            },
            error: null,
          });
        }
        if (table === "exam_draft_questions") {
          return createQueryChain({
            data: [
              {
                id: randomUUID(),
                exam_id: examId,
                question_id: qId,
                display_order: 1,
                points_override: null,
                preserve_order: false,
                question: {
                  id: qId,
                  school_id: schoolId,
                  question_bank_id: randomUUID(),
                  subject_id: subjectId,
                  created_by: admin.userId,
                  current_version_id: randomUUID(),
                  question_type: "single_choice",
                  difficulty: "medium",
                  topic: "Kalkulus",
                  tags: [],
                  status: "active",
                  attachment_metadata: [],
                  content_fingerprint: "fp-calc",
                  created_at: "2026-11-12T00:00:00.000Z",
                  updated_at: "2026-11-12T00:00:00.000Z",
                  subject: { code: "MAT", name: "Matematika" },
                  current_version: {
                    id: randomUUID(),
                    question_id: qId,
                    version_number: 1,
                    stem: "Turunan pertama dari $x^2$ adalah?",
                    explanation: secretExplanation,
                    points: 50,
                    scoring_policy: "exact_match",
                    rubric_notes: secretRubric,
                    preserve_option_order: false,
                    created_by: admin.userId,
                    created_at: "2026-11-12T00:00:00.000Z",
                    options: [{ option_key: "A", option_text: "$2x$", display_order: 0 }],
                    answer_key: [{ correct_option_keys: ["A"] }],
                  },
                },
              },
            ],
            error: null,
          });
        }
        if (
          table === "exam_assignments" ||
          table === "exam_schedules" ||
          table === "exam_publication_events"
        ) {
          return createQueryChain({ data: [], error: null });
        }
        if (table === "exam_versions") {
          return createQueryChain({
            data: [
              {
                id: publishedVersionId,
                exam_id: examId,
                version_number: 1,
                title: "UAS Matematika",
                instructions: "Pilih jawaban paling tepat.",
                duration_minutes: 90,
                max_attempts: 1,
                total_points: 50,
                passing_score: 75,
                randomize_questions: true,
                randomize_options: true,
                starts_at: "2026-12-01T08:00:00.000Z",
                ends_at: "2026-12-01T10:00:00.000Z",
                snapshot_hash: "hash-1",
                published_by: admin.userId,
                published_at: "2026-11-12T00:00:00.000Z",
                questions: [],
              },
            ],
            error: null,
          });
        }
        if (table === "exam_version_questions") {
          return createQueryChain({
            data: [
              {
                id: randomUUID(),
                source_question_id: qId,
                display_order: 1,
                question_type: "single_choice",
                stem: "Turunan pertama dari $x^2$ adalah?",
                points: 50,
                options_snapshot: [
                  { option_key: "A", option_text: "$2x$", display_order: 0 },
                  { option_key: "B", option_text: "$x$", display_order: 1 },
                ],
                explanation_snapshot: secretExplanation,
                rubric_notes_snapshot: secretRubric,
                correct_option_keys: ["A"],
              },
            ],
            error: null,
          });
        }
        return createQueryChain({ data: null, error: null });
      }),
    } as unknown as SupabaseClient;

    const publishedPreview = await getExamPreviewService(
      previewSupabase,
      admin,
      examId,
      "student",
      true
    );
    const serialized = JSON.stringify(publishedPreview);

    expect(queriedTables).not.toContain("exam_version_answer_keys");
    expect(queriedTables).not.toContain("question_answer_keys");
    expect(serialized).not.toContain(secretExplanation);
    expect(serialized).not.toContain(secretRubric);
    expect(serialized).not.toContain("correctOptionKeys");
    expect(serialized).not.toContain("correct_option_keys");
    expect(serialized).not.toContain("scoringPolicy");
    expect(serialized).not.toContain("scoring_policy");
    expect(serialized).not.toContain("rubricNotes");
    expect(serialized).not.toContain("explanation");

    // Also verify draft fallback student projection directly
    examStatus = "DRAFT";
    activePublishedVersionId = null;
    const draftPreview = await examRepository.buildStudentSafeExamPreview(
      previewSupabase,
      schoolId,
      examId,
      false
    );
    const draftSerialized = JSON.stringify(draftPreview);
    expect(draftPreview?.source).toBe("draft");
    expect(draftSerialized).not.toContain(secretExplanation);
    expect(draftSerialized).not.toContain(secretRubric);
    expect(draftSerialized).not.toContain("correct_option_keys");
    expect(draftSerialized).not.toContain("scoring_policy");
    expect(draftSerialized).not.toContain("explanation");
  });
});

// Live Supabase PostgreSQL Phase 2 RLS + RPC transactional suite (runs when synthetic test DB env vars are supplied)
const liveUrl = process.env.TEST_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY;
const liveService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(liveUrl && liveAnon && liveService);

describe.skipIf(!hasLiveSupabase)("Live Supabase Phase 2 Question Versioning, Publish & RLS", () => {
  it("verifies immutable question versions, atomic publish snapshots, double-publish rejection, and zero student access to answer keys", async () => {
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

    async function createUser(roleCode: "teacher" | "student", label: string) {
      const email = `p2-${label}-${suffix}@ujiankita.local`;
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
        school_id: schoolId,
      });

      const client = createClient(liveUrl!, liveAnon!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await client.auth.signInWithPassword({ email, password: credential });
      return { userId: uData.user.id, client };
    }

    try {
      await service.from("schools").insert({ id: schoolId, code: `P2-${suffix}`, name: "Sekolah P2" });
      await service.from("academic_years").insert({
        id: yearId,
        school_id: schoolId,
        name: "2026/2027",
        semester: "Ganjil",
        starts_on: "2026-07-01",
        ends_on: "2026-12-20",
        is_active: true,
      });
      await service.from("subjects").insert({
        id: subjectId,
        school_id: schoolId,
        code: `MAT-${suffix}`,
        name: "Matematika",
      });
      await service.from("classes").insert({
        id: classId,
        school_id: schoolId,
        academic_year_id: yearId,
        name: "X-A",
        grade_level: "10",
      });

      const teacher = await createUser("teacher", "teacher");
      const student = await createUser("student", "student");

      const { data: tRow } = await service
        .from("teachers")
        .insert({ user_id: teacher.userId, school_id: schoolId })
        .select("id")
        .single();
      await service.from("teacher_assignments").insert({
        school_id: schoolId,
        teacher_id: tRow!.id,
        class_id: classId,
        subject_id: subjectId,
        academic_year_id: yearId,
      });
      await service.from("question_banks").insert({
        id: bankId,
        school_id: schoolId,
        subject_id: subjectId,
        created_by: teacher.userId,
        title: "Bank Matematika",
      });

      // 1. Create question v1 via atomic RPC as teacher
      const qRes = await teacher.client.rpc("create_question_with_version", {
        p_question_bank_id: bankId,
        p_subject_id: subjectId,
        p_question_type: "single_choice",
        p_difficulty: "easy",
        p_topic: "Aljabar",
        p_tags: ["aljabar"],
        p_status: "active",
        p_attachment_metadata: [],
        p_content_fingerprint: `fp-${suffix}`,
        p_stem: "Berapakah $1+1$?",
        p_explanation: "1+1=2",
        p_points: 10,
        p_scoring_policy: "exact_match",
        p_rubric_notes: null,
        p_preserve_option_order: false,
        p_options: [
          { optionKey: "A", optionText: "2", displayOrder: 0 },
          { optionKey: "B", optionText: "3", displayOrder: 1 },
        ],
        p_correct_option_keys: ["A"],
      });
      expect(qRes.error).toBeNull();
      const questionId = (qRes.data as { question_id: string }).question_id;

      // 2. Create exam, assign class + question, and publish atomically
      const { data: examRow } = await teacher.client
        .from("exams")
        .insert({
          school_id: schoolId,
          subject_id: subjectId,
          academic_year_id: yearId,
          created_by: teacher.userId,
          title: "Ujian Aljabar",
          duration_minutes: 60,
          passing_score: 5,
          starts_at: "2026-11-20T08:00:00.000Z",
          ends_at: "2026-11-20T10:00:00.000Z",
        })
        .select("id, version_lock")
        .single();

      await teacher.client.from("exam_assignments").insert({
        school_id: schoolId,
        exam_id: examRow!.id,
        class_id: classId,
        assigned_by: teacher.userId,
      });
      await teacher.client.from("exam_draft_questions").insert({
        school_id: schoolId,
        exam_id: examRow!.id,
        question_id: questionId,
        display_order: 1,
      });

      const pub1 = await teacher.client.rpc("publish_exam_atomic", {
        p_exam_id: examRow!.id,
        p_expected_version_lock: examRow!.version_lock,
        p_notes: "Initial publish",
      });
      expect(pub1.error).toBeNull();
      const evId = (pub1.data as { exam_version_id: string }).exam_version_id;

      // 3. Double-publish or stale lock must fail
      const pubDuplicate = await teacher.client.rpc("publish_exam_atomic", {
        p_exam_id: examRow!.id,
        p_expected_version_lock: examRow!.version_lock,
        p_notes: "Duplicate click",
      });
      expect(pubDuplicate.error).not.toBeNull();

      // 4. Editing question creates v2 without mutating published v1 snapshot
      await teacher.client.rpc("update_question_new_version", {
        p_question_id: questionId,
        p_difficulty: "medium",
        p_topic: "Aljabar",
        p_tags: ["aljabar"],
        p_status: "active",
        p_attachment_metadata: [],
        p_content_fingerprint: `fp2-${suffix}`,
        p_stem: "Berapakah $2+2$?",
        p_explanation: "4",
        p_points: 20,
        p_scoring_policy: "exact_match",
        p_rubric_notes: null,
        p_preserve_option_order: false,
        p_options: [
          { optionKey: "A", optionText: "4", displayOrder: 0 },
          { optionKey: "B", optionText: "5", displayOrder: 1 },
        ],
        p_correct_option_keys: ["A"],
      });

      const { data: snapQs } = await teacher.client
        .from("exam_version_questions")
        .select("stem, points")
        .eq("exam_version_id", evId);
      expect(snapQs?.[0]?.stem).toBe("Berapakah $1+1$?");
      expect(Number(snapQs?.[0]?.points)).toBe(10);

      // 5. Student has ZERO RLS read access to bank answer keys or published answer keys
      const [sBankKeys, sPubKeys, sQuestions] = await Promise.all([
        student.client.from("question_answer_keys").select("id"),
        student.client.from("exam_version_answer_keys").select("id"),
        student.client.from("questions").select("id"),
      ]);
      expect(sBankKeys.data ?? []).toHaveLength(0);
      expect(sPubKeys.data ?? []).toHaveLength(0);
      expect(sQuestions.data ?? []).toHaveLength(0);
    } finally {
      for (const uid of createdUsers) {
        await service.auth.admin.deleteUser(uid);
      }
      await service.from("schools").delete().eq("id", schoolId);
    }
  });
});
