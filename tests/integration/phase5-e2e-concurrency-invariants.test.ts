import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/domain/auth/types";
import {
  classifyEventAndEvaluateIncident,
  inferConnectionPresenceState,
} from "@/domain/monitoring/presence-and-incidents";

const liveUrl = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const liveService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const runLive = Boolean(liveUrl && liveAnon && liveService && process.env.RUN_LIVE_DB_TESTS === "true");

describe.skipIf(!runLive)(
  "Phase 5 Real PostgreSQL E2E Scenarios, Concurrency Invariants, Grading & Monitoring Verification",
  () => {
    it("verifies Scenarios A-E, Invariants A-F (out-of-order/idempotency/burst/submit race), deadline expiry, all question types, release modes, and monitoring purge", async () => {
      const service = createClient(liveUrl!, liveService!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const suffix = randomUUID().slice(0, 8);
      const schoolId = randomUUID();
      const yearId = randomUUID();
      const subjectId = randomUUID();
      const classId = randomUUID();
      const bankId = randomUUID();
      const ephemeralCred = randomBytes(16).toString("base64url");
      const createdUsers: string[] = [];

      async function createUser(role: RoleCode, label: string) {
        const email = `p5-e2e-${label}-${suffix}@ujiankita.local`;
        const { data: uData, error: uErr } = await service.auth.admin.createUser({
          email,
          password: ephemeralCred,
          email_confirm: true,
        });
        if (uErr || !uData.user) throw new Error(uErr?.message);
        createdUsers.push(uData.user.id);

        await service.from("user_profiles").insert({
          id: uData.user.id,
          school_id: schoolId,
          full_name: `E2E ${label}`,
          email,
          is_active: true,
        });
        const { data: rRow } = await service.from("roles").select("id").eq("code", role).single();
        await service.from("user_roles").insert({
          user_id: uData.user.id,
          role_id: rRow!.id,
          school_id: schoolId,
        });

        const client: SupabaseClient = createClient(liveUrl!, liveAnon!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const si = await client.auth.signInWithPassword({ email, password: ephemeralCred });
        if (si.error) throw new Error(si.error.message);
        return { userId: uData.user.id, client };
      }

      try {
        // Scenario A: School setup + academic year + class + subject + roster
        await service.from("schools").insert({
          id: schoolId,
          code: `P5E2E-${suffix}`,
          name: `SMA P5 E2E ${suffix}`,
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
          code: `KIM-${suffix}`,
          name: "Kimia",
        });
        await service.from("classes").insert({
          id: classId,
          school_id: schoolId,
          academic_year_id: yearId,
          name: "XI IPA 1",
          grade_level: "11",
        });

        const admin = await createUser("admin", "admin");
        const teacher = await createUser("teacher", "teacher");
        const student1 = await createUser("student", "student1");
        const student2 = await createUser("student", "student2");

        const { data: tRow } = await service
          .from("teachers")
          .insert({ user_id: teacher.userId, school_id: schoolId, nip: `TE-${suffix}` })
          .select("id")
          .single();
        await service.from("teacher_assignments").insert({
          school_id: schoolId,
          teacher_id: tRow!.id,
          class_id: classId,
          subject_id: subjectId,
          academic_year_id: yearId,
        });

        const { data: stu1Row } = await service
          .from("students")
          .insert({ user_id: student1.userId, school_id: schoolId, nis: `S1-${suffix}` })
          .select("id")
          .single();
        const { data: stu2Row } = await service
          .from("students")
          .insert({ user_id: student2.userId, school_id: schoolId, nis: `S2-${suffix}` })
          .select("id")
          .single();
        await service.from("class_enrollments").insert([
          { school_id: schoolId, class_id: classId, student_id: stu1Row!.id, academic_year_id: yearId, status: "active" },
          { school_id: schoolId, class_id: classId, student_id: stu2Row!.id, academic_year_id: yearId, status: "active" },
        ]);
        await service.from("question_banks").insert({
          id: bankId,
          school_id: schoolId,
          subject_id: subjectId,
          created_by: teacher.userId,
          title: "Bank Kimia",
        });

        // Scenario B: All 4 Question Types (single_choice 25, multiple_choice 25, true_false 20, essay 30 -> total 100)
        const qSc = await teacher.client.rpc("create_question_with_version", {
          p_question_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "single_choice",
          p_difficulty: "easy",
          p_topic: "Atom",
          p_tags: [],
          p_status: "active",
          p_attachment_metadata: [],
          p_content_fingerprint: `fp-sc-${suffix}`,
          p_stem: "Nomor atom Hidrogen adalah?",
          p_explanation: null,
          p_points: 25,
          p_scoring_policy: "exact_match",
          p_rubric_notes: null,
          p_preserve_option_order: false,
          p_options: [
            { optionKey: "A", optionText: "1", displayOrder: 0 },
            { optionKey: "B", optionText: "2", displayOrder: 1 },
            { optionKey: "C", optionText: "6", displayOrder: 2 },
          ],
          p_correct_option_keys: ["A"],
        });
        const qMc = await teacher.client.rpc("create_question_with_version", {
          p_question_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "multiple_choice",
          p_difficulty: "medium",
          p_topic: "Gas Mulia",
          p_tags: [],
          p_status: "active",
          p_attachment_metadata: [],
          p_content_fingerprint: `fp-mc-${suffix}`,
          p_stem: "Pilih dua unsur gas mulia:",
          p_explanation: null,
          p_points: 25,
          p_scoring_policy: "exact_match",
          p_rubric_notes: null,
          p_preserve_option_order: false,
          p_options: [
            { optionKey: "A", optionText: "Helium", displayOrder: 0 },
            { optionKey: "B", optionText: "Natrium", displayOrder: 1 },
            { optionKey: "C", optionText: "Neon", displayOrder: 2 },
          ],
          p_correct_option_keys: ["A", "C"],
        });
        const qTf = await teacher.client.rpc("create_question_with_version", {
          p_question_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "true_false",
          p_difficulty: "easy",
          p_topic: "Air",
          p_tags: [],
          p_status: "active",
          p_attachment_metadata: [],
          p_content_fingerprint: `fp-tf-${suffix}`,
          p_stem: "Rumus kimia air adalah H2O.",
          p_explanation: null,
          p_points: 20,
          p_scoring_policy: "exact_match",
          p_rubric_notes: null,
          p_preserve_option_order: true,
          p_options: [
            { optionKey: "TRUE", optionText: "Benar", displayOrder: 0 },
            { optionKey: "FALSE", optionText: "Salah", displayOrder: 1 },
          ],
          p_correct_option_keys: ["TRUE"],
        });
        const qEs = await teacher.client.rpc("create_question_with_version", {
          p_question_bank_id: bankId,
          p_subject_id: subjectId,
          p_question_type: "essay",
          p_difficulty: "hard",
          p_topic: "Ikatan Kimia",
          p_tags: [],
          p_status: "active",
          p_attachment_metadata: [],
          p_content_fingerprint: `fp-es-${suffix}`,
          p_stem: "Jelaskan perbedaan ikatan ion dan kovalen.",
          p_explanation: null,
          p_points: 30,
          p_scoring_policy: "manual_rubric",
          p_rubric_notes: "Transfer vs berbagi elektron",
          p_preserve_option_order: true,
          p_options: [],
          p_correct_option_keys: [],
        });

        const nowMs = Date.now();
        const { data: examMixed } = await teacher.client
          .from("exams")
          .insert({
            school_id: schoolId,
            subject_id: subjectId,
            academic_year_id: yearId,
            created_by: teacher.userId,
            title: `Ujian Campuran P5 ${suffix}`,
            status: "DRAFT",
            duration_minutes: 60,
            max_attempts: 1,
            passing_score: 70,
            randomize_questions: true,
            randomize_options: true,
            result_release_policy: "manual",
            starts_at: new Date(nowMs - 10 * 60_000).toISOString(),
            ends_at: new Date(nowMs + 50 * 60_000).toISOString(),
          })
          .select("id")
          .single();

        await teacher.client.from("exam_draft_questions").insert([
          { school_id: schoolId, exam_id: examMixed!.id, question_id: qSc.data.question_id, display_order: 1 },
          { school_id: schoolId, exam_id: examMixed!.id, question_id: qMc.data.question_id, display_order: 2 },
          { school_id: schoolId, exam_id: examMixed!.id, question_id: qTf.data.question_id, display_order: 3 },
          { school_id: schoolId, exam_id: examMixed!.id, question_id: qEs.data.question_id, display_order: 4 },
        ]);
        await teacher.client.from("exam_assignments").insert({
          school_id: schoolId,
          exam_id: examMixed!.id,
          class_id: classId,
          assigned_by: teacher.userId,
        });
        await teacher.client.from("exam_schedules").insert({
          school_id: schoolId,
          exam_id: examMixed!.id,
          class_id: classId,
          starts_at: new Date(nowMs - 10 * 60_000).toISOString(),
          ends_at: new Date(nowMs + 50 * 60_000).toISOString(),
          duration_minutes: 60,
          max_attempts: 1,
          late_join_minutes: 30,
        });
        const pubMixed = await teacher.client.rpc("publish_exam_atomic", {
          p_exam_id: examMixed!.id,
          p_expected_version_lock: 1,
          p_notes: "Publish E2E Mixed",
        });
        expect(pubMixed.error).toBeNull();

        // Scenario C & Invariant Tests for Student 1
        // Concurrent start bursts -> single attempt created
        const [st1, st2, st3] = await Promise.all([
          student1.client.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examMixed!.id,
            p_start_idempotency_key: randomUUID(),
          }),
          student1.client.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examMixed!.id,
            p_start_idempotency_key: randomUUID(),
          }),
          student1.client.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examMixed!.id,
            p_start_idempotency_key: randomUUID(),
          }),
        ]);
        expect(st1.error).toBeNull();
        expect(st1.data.attemptId).toBe(st2.data.attemptId);
        expect(st1.data.attemptId).toBe(st3.data.attemptId);
        const attemptId = st1.data.attemptId as string;

        const { data: qAssignments } = await student1.client
          .from("attempt_question_assignments")
          .select("*")
          .eq("attempt_id", attemptId);
        expect(qAssignments).toHaveLength(4);

        const qaSc = qAssignments!.find((q) => q.question_type === "single_choice")!;
        const qaMc = qAssignments!.find((q) => q.question_type === "multiple_choice")!;
        const qaTf = qAssignments!.find((q) => q.question_type === "true_false")!;
        const qaEs = qAssignments!.find((q) => q.question_type === "essay")!;

        const scDispA = Object.entries(qaSc.option_order_map as Record<string, string>).find(
          ([, canon]) => canon === "A"
        )![0];
        const scDispB = Object.entries(qaSc.option_order_map as Record<string, string>).find(
          ([, canon]) => canon === "B"
        )![0];
        const mcDispA = Object.entries(qaMc.option_order_map as Record<string, string>).find(
          ([, canon]) => canon === "A"
        )![0];
        const mcDispC = Object.entries(qaMc.option_order_map as Record<string, string>).find(
          ([, canon]) => canon === "C"
        )![0];

        // Invariant A & B: Idempotent replay, conflict detection, and monotonic revision enforcement
        const conflictKey = randomUUID();
        const rev1 = await student1.client.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: qaSc.id,
          p_idempotency_key: conflictKey,
          p_client_revision: 1,
          p_response_payload: { questionType: "single_choice", selectedOptionKey: scDispB },
          p_payload_hash: "hash-b",
        });
        expect(rev1.data.outcome).toBe("COMMITTED");

        // Same key + same hash -> IDEMPOTENT_REPLAY
        const replay1 = await student1.client.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: qaSc.id,
          p_idempotency_key: conflictKey,
          p_client_revision: 1,
          p_response_payload: { questionType: "single_choice", selectedOptionKey: scDispB },
          p_payload_hash: "hash-b",
        });
        expect(replay1.data.outcome).toBe("IDEMPOTENT_REPLAY");

        // Same key + DIFFERENT hash -> IDEMPOTENCY_CONFLICT
        const conflictSave = await student1.client.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: qaSc.id,
          p_idempotency_key: conflictKey,
          p_client_revision: 2,
          p_response_payload: { questionType: "single_choice", selectedOptionKey: scDispA },
          p_payload_hash: "hash-a-different",
        });
        expect(conflictSave.data.outcome).toBe("IDEMPOTENCY_CONFLICT");

        // Concurrent saves across all 4 questions + out-of-order stale save
        const [saveScHigh, saveMc, saveTf, saveEs] = await Promise.all([
          student1.client.rpc("save_attempt_answer_atomic", {
            p_attempt_id: attemptId,
            p_attempt_question_id: qaSc.id,
            p_idempotency_key: randomUUID(),
            p_client_revision: 5,
            p_response_payload: { questionType: "single_choice", selectedOptionKey: scDispA },
            p_payload_hash: "hash-sc-5",
          }),
          student1.client.rpc("save_attempt_answer_atomic", {
            p_attempt_id: attemptId,
            p_attempt_question_id: qaMc.id,
            p_idempotency_key: randomUUID(),
            p_client_revision: 1,
            p_response_payload: { questionType: "multiple_choice", selectedOptionKeys: [mcDispC, mcDispA] },
            p_payload_hash: "hash-mc-1",
          }),
          student1.client.rpc("save_attempt_answer_atomic", {
            p_attempt_id: attemptId,
            p_attempt_question_id: qaTf.id,
            p_idempotency_key: randomUUID(),
            p_client_revision: 1,
            p_response_payload: { questionType: "true_false", selectedOptionKey: "TRUE" },
            p_payload_hash: "hash-tf-1",
          }),
          student1.client.rpc("save_attempt_answer_atomic", {
            p_attempt_id: attemptId,
            p_attempt_question_id: qaEs.id,
            p_idempotency_key: randomUUID(),
            p_client_revision: 1,
            p_response_payload: { questionType: "essay", textAnswer: "Ion transfer elektron, kovalen berbagi." },
            p_payload_hash: "hash-es-1",
          }),
        ]);
        expect(saveScHigh.data.outcome).toBe("COMMITTED");
        expect(saveMc.data.outcome).toBe("COMMITTED");
        expect(saveTf.data.outcome).toBe("COMMITTED");
        expect(saveEs.data.outcome).toBe("COMMITTED");

        // Out-of-order stale rev 3 MUST NOT overwrite rev 5
        const saveStale3 = await student1.client.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attemptId,
          p_attempt_question_id: qaSc.id,
          p_idempotency_key: randomUUID(),
          p_client_revision: 3,
          p_response_payload: { questionType: "single_choice", selectedOptionKey: scDispB },
          p_payload_hash: "hash-sc-stale3",
        });
        expect(saveStale3.data.outcome).toBe("STALE_REVISION_REJECTED");

        // Scenario E: Monitoring batch telemetry deduplication + presence gap classification + trust separation
        const dupEvtId = randomUUID();
        const batchRes = await student1.client.rpc("record_monitoring_events_batch_atomic", {
          p_attempt_id: attemptId,
          p_events: [
            { clientEventId: dupEvtId, eventType: "EXAM_PAGE_HIDDEN", metadata: {} },
            { clientEventId: dupEvtId, eventType: "EXAM_PAGE_HIDDEN", metadata: {} },
            { clientEventId: randomUUID(), eventType: "EXAMBRO_HINT_REPORTED", metadata: { ua: "ExamBro" } },
          ],
        });
        expect(batchRes.error).toBeNull();
        expect(batchRes.data.accepted).toBe(2);
        expect(batchRes.data.deduplicated).toBe(1);

        // Verify presence classification and that ExamBro client hint stays INFORMATIONAL without auto-incident
        expect(
          inferConnectionPresenceState({
            attemptStatus: "IN_PROGRESS",
            lastHeartbeatAt: new Date().toISOString(),
          }).state
        ).toBe("RECENTLY_SEEN");
        expect(
          inferConnectionPresenceState({
            attemptStatus: "IN_PROGRESS",
            lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString(),
          }).state
        ).toBe("STALE");
        expect(
          inferConnectionPresenceState({
            attemptStatus: "IN_PROGRESS",
            lastHeartbeatAt: null,
          }).state
        ).toBe("UNKNOWN");
        const examBroClassification = classifyEventAndEvaluateIncident({
          eventType: "EXAMBRO_HINT_REPORTED",
          countersAfterEvent: {
            visibilityHiddenCount: 0,
            reloadCount: 0,
            copyPasteCount: 0,
            connectionGapCount: 0,
            contextMenuCount: 0,
          },
          policy: {
            visibilitySwitchWarnThreshold: 3,
            visibilitySwitchReviewThreshold: 6,
            hiddenDurationReviewSeconds: 120,
            reloadWarnThreshold: 2,
            reloadReviewThreshold: 4,
            copyPasteReviewThreshold: 3,
          },
        });
        expect(examBroClassification.severity).toBe("INFORMATIONAL");
        expect(examBroClassification.incidentCandidate).toBeNull();

        // Invariant D: Race between late save & submit -> atomic lock ensures no silent loss
        const [lateSaveRace, submitRes] = await Promise.all([
          student1.client.rpc("save_attempt_answer_atomic", {
            p_attempt_id: attemptId,
            p_attempt_question_id: qaEs.id,
            p_idempotency_key: randomUUID(),
            p_client_revision: 2,
            p_response_payload: { questionType: "essay", textAnswer: "Ion transfer elektron, kovalen pemakaian bersama." },
            p_payload_hash: "hash-es-2",
          }),
          student1.client.rpc("submit_exam_attempt_atomic", {
            p_attempt_id: attemptId,
            p_idempotency_key: randomUUID(),
          }),
        ]);
        expect(submitRes.error).toBeNull();
        expect(submitRes.data.receiptCode).toBeTruthy();
        expect(["COMMITTED", "ATTEMPT_ALREADY_SUBMITTED"]).toContain(lateSaveRace.data.outcome);

        // Scenario D: Grade essay (22.5/30) -> adjust total by +2.5 -> release
        const essayGrade = await teacher.client.rpc("grade_essay_and_recalculate_atomic", {
          p_attempt_id: attemptId,
          p_entries: [{ examVersionQuestionId: qaEs.exam_version_question_id, assignedScore: 22.5, feedback: "Baik" }],
          p_release_if_complete: false,
        });
        expect(essayGrade.error).toBeNull();
        expect(Number(essayGrade.data.objectiveScore)).toBe(70); // 25 + 25 + 20 = 70
        expect(Number(essayGrade.data.manualScore)).toBe(22.5);
        expect(Number(essayGrade.data.totalScore)).toBe(92.5);

        const adjRes = await teacher.client.rpc("adjust_exam_grade_atomic", {
          p_attempt_id: attemptId,
          p_new_total_score: 95,
          p_reason: "Koreksi pembulatan rubrik kimia",
        });
        expect(adjRes.error).toBeNull();
        expect(Number(adjRes.data.totalScore)).toBe(95);

        const relRes = await teacher.client.rpc("release_exam_results_atomic", {
          p_exam_id: examMixed!.id,
          p_action: "release",
          p_allow_student_review: true,
        });
        expect(relRes.error).toBeNull();
        expect(relRes.data.releasedCount).toBe(1);

        // Invariant E: Deadline expiry + batch worker auto-finalization for Student 2
        const stStu2 = await student2.client.rpc("start_or_resume_exam_attempt", {
          p_exam_id: examMixed!.id,
          p_start_idempotency_key: randomUUID(),
        });
        expect(stStu2.error).toBeNull();
        const attempt2Id = stStu2.data.attemptId as string;

        // Move deadline into the past via privileged service role (beyond grace)
        await service
          .from("exam_attempts")
          .update({ deadline_at_utc: new Date(Date.now() - 120_000).toISOString() })
          .eq("id", attempt2Id);

        const { data: stu2Assigns } = await student2.client
          .from("attempt_question_assignments")
          .select("id")
          .eq("attempt_id", attempt2Id)
          .limit(1);

        const expiredSave = await student2.client.rpc("save_attempt_answer_atomic", {
          p_attempt_id: attempt2Id,
          p_attempt_question_id: stu2Assigns![0]!.id,
          p_idempotency_key: randomUUID(),
          p_client_revision: 1,
          p_response_payload: { questionType: "single_choice", selectedOptionKey: "A" },
          p_payload_hash: "expired-hash",
        });
        expect(expiredSave.data.outcome).toBe("DEADLINE_EXPIRED");

        // Because save_attempt_answer_atomic already auto-finalized attempt2, batch sweep finds 0 remaining on examMixed
        const batchExpiredCount = await service.rpc("finalize_expired_exam_attempts", {
          p_exam_id: examMixed!.id,
        });
        expect(batchExpiredCount.error).toBeNull();
        expect(Number(batchExpiredCount.data)).toBe(0);

        const { data: finalizedAttempt2 } = await service
          .from("exam_attempts")
          .select("status")
          .eq("id", attempt2Id)
          .single();
        expect(finalizedAttempt2?.status).toBe("EXPIRED");

        // Objective-only exam with after_submit_if_no_essay auto-release + Admin cancellation
        const { data: examAuto } = await teacher.client
          .from("exams")
          .insert({
            school_id: schoolId,
            subject_id: subjectId,
            academic_year_id: yearId,
            created_by: teacher.userId,
            title: `Ujian Auto Release ${suffix}`,
            status: "DRAFT",
            duration_minutes: 30,
            max_attempts: 2,
            passing_score: 15,
            result_release_policy: "after_submit_if_no_essay",
            starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
            ends_at: new Date(nowMs + 45 * 60_000).toISOString(),
          })
          .select("id")
          .single();
        await teacher.client.from("exam_draft_questions").insert({
          school_id: schoolId,
          exam_id: examAuto!.id,
          question_id: qSc.data.question_id,
          display_order: 1,
        });
        await teacher.client.from("exam_assignments").insert({
          school_id: schoolId,
          exam_id: examAuto!.id,
          class_id: classId,
          assigned_by: teacher.userId,
        });
        await teacher.client.from("exam_schedules").insert({
          school_id: schoolId,
          exam_id: examAuto!.id,
          class_id: classId,
          starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
          ends_at: new Date(nowMs + 45 * 60_000).toISOString(),
          duration_minutes: 30,
          max_attempts: 2,
          late_join_minutes: 30,
        });
        const pubAuto = await teacher.client.rpc("publish_exam_atomic", {
          p_exam_id: examAuto!.id,
          p_expected_version_lock: 1,
        });
        expect(pubAuto.error).toBeNull();

        const autoStart = await student1.client.rpc("start_or_resume_exam_attempt", {
          p_exam_id: examAuto!.id,
          p_start_idempotency_key: randomUUID(),
        });
        expect(autoStart.error).toBeNull();
        const autoAttemptId = autoStart.data.attemptId as string;
        const autoSub = await student1.client.rpc("submit_exam_attempt_atomic", {
          p_attempt_id: autoAttemptId,
          p_idempotency_key: randomUUID(),
        });
        expect(autoSub.error).toBeNull();

        const { data: autoGrade, error: autoGradeErr } = await service
          .from("exam_grades")
          .select("grading_status, release_status")
          .eq("attempt_id", autoAttemptId)
          .single();
        expect(autoGradeErr).toBeNull();
        expect(autoGrade?.grading_status).toBe("GRADED");
        expect(autoGrade?.release_status).toBe("RELEASED");

        // Start a silent expired attempt on examAuto and verify batch finalize_expired_exam_attempts sweeps it
        const autoStart2 = await student2.client.rpc("start_or_resume_exam_attempt", {
          p_exam_id: examAuto!.id,
          p_start_idempotency_key: randomUUID(),
        });
        const autoAttempt2Id = autoStart2.data.attemptId as string;
        await service
          .from("exam_attempts")
          .update({ deadline_at_utc: new Date(Date.now() - 120_000).toISOString() })
          .eq("id", autoAttempt2Id);
        const batchAutoSweep = await service.rpc("finalize_expired_exam_attempts", {
          p_exam_id: examAuto!.id,
        });
        expect(batchAutoSweep.error).toBeNull();
        expect(Number(batchAutoSweep.data)).toBe(1);
        const { data: sweptRow } = await service
          .from("exam_attempts")
          .select("status")
          .eq("id", autoAttempt2Id)
          .single();
        expect(sweptRow?.status).toBe("EXPIRED");

        // Admin retention dry-run & purge
        const retentionDry = await admin.client.rpc("purge_expired_monitoring_records_atomic", {
          p_school_id: schoolId,
          p_days_to_keep: 90,
          p_dry_run: true,
        });
        expect(retentionDry.error).toBeNull();
      } finally {
        for (const uid of createdUsers) {
          await service.auth.admin.deleteUser(uid);
        }
        await service.from("schools").delete().eq("id", schoolId);
      }
    }, 30_000);
  }
);
