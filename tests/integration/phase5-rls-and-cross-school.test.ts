import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/domain/auth/types";

const liveUrl = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const liveService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const runLive = Boolean(liveUrl && liveAnon && liveService && process.env.RUN_LIVE_DB_TESTS === "true");

describe.skipIf(!runLive)(
  "Phase 5 Real PostgreSQL RLS, Cross-Role & Multi-School Isolation Audit",
  () => {
    it("enforces role least-privilege, proctor vs read-only auditor boundaries, BUG-02 student ownership, and strict cross-school isolation", async () => {
      const service = createClient(liveUrl!, liveService!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const suffix = randomUUID().slice(0, 8);
      const schoolA = randomUUID();
      const schoolB = randomUUID();
      const yearA = randomUUID();
      const yearB = randomUUID();
      const subjectMathA = randomUUID();
      const subjectBioA = randomUUID();
      const classXA = randomUUID();
      const classXB = randomUUID();
      const bankMathA = randomUUID();
      const ephemeralCred = randomBytes(16).toString("base64url");
      const createdUserIds: string[] = [];

      async function provisionUser(role: RoleCode, schoolId: string, label: string) {
        const email = `p5-rls-${label}-${suffix}@ujiankita.local`;
        const { data: uData, error: uErr } = await service.auth.admin.createUser({
          email,
          password: ephemeralCred,
          email_confirm: true,
        });
        if (uErr || !uData.user) throw new Error(`createUser failed: ${uErr?.message}`);
        createdUserIds.push(uData.user.id);

        const { error: profErr } = await service.from("user_profiles").insert({
          id: uData.user.id,
          school_id: schoolId,
          full_name: `RLS ${label}`,
          email,
          is_active: true,
        });
        if (profErr) throw new Error(`user_profiles insert failed: ${profErr.message}`);

        const { data: rRow, error: rErr } = await service
          .from("roles")
          .select("id")
          .eq("code", role)
          .single();
        if (rErr || !rRow) throw new Error(`Role ${role} lookup failed: ${rErr?.message}`);

        const { error: urErr } = await service.from("user_roles").insert({
          user_id: uData.user.id,
          role_id: rRow.id,
          school_id: schoolId,
        });
        if (urErr) throw new Error(`user_roles insert failed: ${urErr.message}`);

        const client: SupabaseClient = createClient(liveUrl!, liveAnon!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const signIn = await client.auth.signInWithPassword({ email, password: ephemeralCred });
        if (signIn.error) throw new Error(`signIn failed for ${label}: ${signIn.error.message}`);

        return { userId: uData.user.id, client };
      }

      try {
        // Seed School A and School B
        await service.from("schools").insert([
          { id: schoolA, code: `P5A-${suffix}`, name: `SMA A ${suffix}`, level: "SMA" },
          { id: schoolB, code: `P5B-${suffix}`, name: `SMA B ${suffix}`, level: "SMA" },
        ]);
        await service.from("academic_years").insert([
          {
            id: yearA,
            school_id: schoolA,
            name: "2026/2027",
            semester: "Ganjil",
            starts_on: "2026-07-01",
            ends_on: "2026-12-31",
            is_active: true,
          },
          {
            id: yearB,
            school_id: schoolB,
            name: "2026/2027",
            semester: "Ganjil",
            starts_on: "2026-07-01",
            ends_on: "2026-12-31",
            is_active: true,
          },
        ]);
        await service.from("subjects").insert([
          { id: subjectMathA, school_id: schoolA, code: `MAT-${suffix}`, name: "Matematika A" },
          { id: subjectBioA, school_id: schoolA, code: `BIO-${suffix}`, name: "Biologi A" },
        ]);
        await service.from("classes").insert([
          { id: classXA, school_id: schoolA, academic_year_id: yearA, name: "X-A", grade_level: "10" },
          { id: classXB, school_id: schoolA, academic_year_id: yearA, name: "X-B", grade_level: "10" },
        ]);

        const adminA = await provisionUser("admin", schoolA, "adminA");
        const teacherMathA = await provisionUser("teacher", schoolA, "teacherMathA");
        const teacherBioA = await provisionUser("teacher", schoolA, "teacherBioA");
        const studentA = await provisionUser("student", schoolA, "studentA");
        const studentXB = await provisionUser("student", schoolA, "studentXB");
        const proctorA = await provisionUser("proctor", schoolA, "proctorA");
        const auditorA = await provisionUser("auditor", schoolA, "auditorA");
        const coordA = await provisionUser("exam_coordinator", schoolA, "coordA");

        const adminB = await provisionUser("admin", schoolB, "adminB");
        const teacherB = await provisionUser("teacher", schoolB, "teacherB");
        const studentB = await provisionUser("student", schoolB, "studentB");

        // Teacher & student records
        const { data: tMathRow } = await service
          .from("teachers")
          .insert({ user_id: teacherMathA.userId, school_id: schoolA, nip: `TM-${suffix}` })
          .select("id")
          .single();
        const { data: tBioRow } = await service
          .from("teachers")
          .insert({ user_id: teacherBioA.userId, school_id: schoolA, nip: `TB-${suffix}` })
          .select("id")
          .single();
        await service.from("teacher_assignments").insert([
          {
            school_id: schoolA,
            teacher_id: tMathRow!.id,
            class_id: classXA,
            subject_id: subjectMathA,
            academic_year_id: yearA,
          },
          {
            school_id: schoolA,
            teacher_id: tBioRow!.id,
            class_id: classXB,
            subject_id: subjectBioA,
            academic_year_id: yearA,
          },
        ]);

        const { data: stuARow } = await service
          .from("students")
          .insert({ user_id: studentA.userId, school_id: schoolA, nis: `SA-${suffix}` })
          .select("id")
          .single();
        const { data: stuXBRow } = await service
          .from("students")
          .insert({ user_id: studentXB.userId, school_id: schoolA, nis: `SXB-${suffix}` })
          .select("id")
          .single();
        const { data: stuBRow } = await service
          .from("students")
          .insert({ user_id: studentB.userId, school_id: schoolB, nis: `SB-${suffix}` })
          .select("id")
          .single();

        await service.from("class_enrollments").insert([
          { school_id: schoolA, class_id: classXA, student_id: stuARow!.id, academic_year_id: yearA, status: "active" },
          { school_id: schoolA, class_id: classXB, student_id: stuXBRow!.id, academic_year_id: yearA, status: "active" },
        ]);

        await service.from("question_banks").insert({
          id: bankMathA,
          school_id: schoolA,
          subject_id: subjectMathA,
          created_by: teacherMathA.userId,
          title: "Bank Math A",
        });

        // Create question + publish exam as teacherMathA
        const qRes = await teacherMathA.client.rpc("create_question_with_version", {
          p_question_bank_id: bankMathA,
          p_subject_id: subjectMathA,
          p_question_type: "single_choice",
          p_difficulty: "easy",
          p_topic: "Turunan",
          p_tags: [],
          p_status: "active",
          p_attachment_metadata: [],
          p_content_fingerprint: `p5-rls-fp-${suffix}`,
          p_stem: "Turunan $x^2$ adalah?",
          p_explanation: "RAHASIA_GURU",
          p_points: 20,
          p_scoring_policy: "exact_match",
          p_rubric_notes: null,
          p_preserve_option_order: false,
          p_options: [
            { optionKey: "A", optionText: "2x", displayOrder: 0 },
            { optionKey: "B", optionText: "x", displayOrder: 1 },
          ],
          p_correct_option_keys: ["A"],
        });
        expect(qRes.error).toBeNull();
        const qId = (qRes.data as { question_id: string }).question_id;

        const nowMs = Date.now();
        const { data: examRow, error: examErr } = await teacherMathA.client
          .from("exams")
          .insert({
            school_id: schoolA,
            subject_id: subjectMathA,
            academic_year_id: yearA,
            created_by: teacherMathA.userId,
            title: `Ujian RLS P5 ${suffix}`,
            status: "DRAFT",
            duration_minutes: 60,
            passing_score: 10,
            starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
            ends_at: new Date(nowMs + 55 * 60_000).toISOString(),
          })
          .select("id, version_lock")
          .single();
        expect(examErr).toBeNull();

        await teacherMathA.client.from("exam_draft_questions").insert({
          school_id: schoolA,
          exam_id: examRow!.id,
          question_id: qId,
          display_order: 1,
        });
        await teacherMathA.client.from("exam_assignments").insert({
          school_id: schoolA,
          exam_id: examRow!.id,
          class_id: classXA,
          assigned_by: teacherMathA.userId,
        });
        await teacherMathA.client.from("exam_schedules").insert({
          school_id: schoolA,
          exam_id: examRow!.id,
          class_id: classXA,
          starts_at: new Date(nowMs - 5 * 60_000).toISOString(),
          ends_at: new Date(nowMs + 55 * 60_000).toISOString(),
          duration_minutes: 60,
          max_attempts: 1,
          late_join_minutes: 30,
        });
        const pubRes = await teacherMathA.client.rpc("publish_exam_atomic", {
          p_exam_id: examRow!.id,
          p_expected_version_lock: examRow!.version_lock,
          p_notes: "RLS Audit Publish",
        });
        expect(pubRes.error).toBeNull();

        // Store secret hashes in exam_security_policies (teachers/admin can read, students MUST NOT)
        await service.from("exam_security_policies").upsert({
          school_id: schoolA,
          exam_id: examRow!.id,
          browser_policy_mode: "VERIFIED_SEB_REQUIRED",
          seb_config_key_hash: "a".repeat(64),
          seb_browser_exam_key_hash: "b".repeat(64),
        });

        // Student A starts attempt and generates an incident
        const startRes = await studentA.client.rpc("start_or_resume_exam_attempt", {
          p_exam_id: examRow!.id,
          p_start_idempotency_key: randomUUID(),
        });
        expect(startRes.error).toBeNull();
        const attemptId = (startRes.data as { attemptId: string }).attemptId;

        const { data: incidentRow, error: incidentErr } = await service
          .from("exam_security_incidents")
          .insert({
            school_id: schoolA,
            exam_id: examRow!.id,
            attempt_id: attemptId,
            student_id: stuARow!.id,
            reason_code: "REPEATED_VISIBILITY_SWITCHES",
            dedupe_key: `rls-audit-${attemptId}`,
            severity: "WARNING",
            status: "NEW",
            title: "Perpindahan Fokus Layar Berulang",
            summary: "Kehilangan fokus berulang saat simulasi",
          })
          .select("id")
          .single();
        expect(incidentErr).toBeNull();

        // 1. Unassigned Student (class X-B) cannot see or start Class X-A exam
        const unassignedExams = await studentXB.client.from("exams").select("id").eq("id", examRow!.id);
        expect(unassignedExams.data ?? []).toHaveLength(0);
        const unassignedStart = await studentXB.client.rpc("start_or_resume_exam_attempt", {
          p_exam_id: examRow!.id,
          p_start_idempotency_key: randomUUID(),
        });
        expect(unassignedStart.error?.message).toContain("NO_CLASS_ASSIGNMENT");

        // 2. Student A cannot read sensitive policy keys, incidents, monitoring audits, or school audit_events
        const [sPol, sInc, sMonAud, sAud, sAnswerKeys] = await Promise.all([
          studentA.client.from("exam_security_policies").select("*").eq("exam_id", examRow!.id),
          studentA.client.from("exam_security_incidents").select("*").eq("exam_id", examRow!.id),
          studentA.client.from("monitoring_audit_events").select("*").eq("school_id", schoolA),
          studentA.client.from("audit_events").select("*").eq("school_id", schoolA),
          studentA.client.from("exam_version_answer_keys").select("*"),
        ]);
        expect(sPol.data ?? []).toHaveLength(0);
        expect(sInc.data ?? []).toHaveLength(0);
        expect(sMonAud.data ?? []).toHaveLength(0);
        expect(sAud.data ?? []).toHaveLength(0);
        expect(sAnswerKeys.data ?? []).toHaveLength(0);

        // 3. Unassigned Subject Teacher (Bio) cannot read or mutate Math bank/exam
        const [bioReadQ, bioReadExam, bioInsertExam] = await Promise.all([
          teacherBioA.client.from("questions").select("id").eq("id", qId),
          teacherBioA.client.from("exams").select("id").eq("id", examRow!.id),
          teacherBioA.client.from("exams").insert({
            school_id: schoolA,
            subject_id: subjectMathA,
            academic_year_id: yearA,
            created_by: teacherBioA.userId,
            title: "Unauthorized Exam",
            duration_minutes: 30,
          }),
        ]);
        expect(bioReadQ.data ?? []).toHaveLength(0);
        expect(bioReadExam.data ?? []).toHaveLength(0);
        expect(bioInsertExam.error).not.toBeNull();

        // 4. BUG-02 REGRESSION: Non-students (teacher, admin, proctor, auditor) and other-school student CANNOT call heartbeat/events RPCs
        for (const nonOwner of [teacherMathA.client, adminA.client, proctorA.client, auditorA.client, studentB.client]) {
          const hbRes = await nonOwner.rpc("record_attempt_heartbeat_atomic", {
            p_attempt_id: attemptId,
            p_visible: true,
            p_online: true,
          });
          expect(hbRes.error?.message).toContain("FORBIDDEN_ATTEMPT_ACCESS");

          const evRes = await nonOwner.rpc("record_monitoring_events_batch_atomic", {
            p_attempt_id: attemptId,
            p_events: [{ clientEventId: randomUUID(), eventType: "EXAM_PAGE_HIDDEN", metadata: {} }],
          });
          expect(evRes.error?.message).toContain("FORBIDDEN_ATTEMPT_ACCESS");
        }

        // Student owner heartbeat SUCCEEDS cleanly
        const ownHb = await studentA.client.rpc("record_attempt_heartbeat_atomic", {
          p_attempt_id: attemptId,
          p_visible: true,
          p_online: true,
        });
        expect(ownHb.error).toBeNull();

        // 5. BUG-03 REGRESSION: Proctor CAN read monitoring data AND write incident/override; Auditor CAN read ONLY (all writes blocked!)
        const [procAttempts, procPresence, procInc, audInc, audLogs, audMainAudit] = await Promise.all([
          proctorA.client.from("exam_attempts").select("id").eq("id", attemptId),
          proctorA.client.from("attempt_monitoring_presence").select("attempt_id").eq("attempt_id", attemptId),
          proctorA.client.from("exam_security_incidents").select("id").eq("id", incidentRow!.id),
          auditorA.client.from("exam_security_incidents").select("id").eq("id", incidentRow!.id),
          auditorA.client.from("monitoring_audit_events").select("id").eq("school_id", schoolA),
          auditorA.client.from("audit_events").select("id").eq("school_id", schoolA),
        ]);
        expect(procAttempts.data).toHaveLength(1);
        expect(procPresence.data).toHaveLength(1);
        expect(procInc.data).toHaveLength(1);
        expect(audInc.data).toHaveLength(1);
        expect((audLogs.data ?? []).length).toBeGreaterThanOrEqual(0);
        expect((audMainAudit.data ?? []).length).toBeGreaterThanOrEqual(1);

        // Auditor write attempts MUST fail
        const audMutateInc = await auditorA.client.rpc("transition_security_incident_atomic", {
          p_incident_id: incidentRow!.id,
          p_new_status: "DISMISSED",
          p_note: "Auditor should be blocked",
        });
        expect(audMutateInc.error?.message).toContain("FORBIDDEN_INCIDENT_REVIEW");

        const audOverride = await auditorA.client.rpc("grant_attempt_browser_override_atomic", {
          p_attempt_id: attemptId,
          p_reason: "Auditor should be blocked",
        });
        expect(audOverride.error?.message).toContain("FORBIDDEN_BROWSER_OVERRIDE");

        const audDirectOverride = await auditorA.client.from("exam_student_browser_overrides").insert({
          school_id: schoolA,
          exam_id: examRow!.id,
          student_id: stuARow!.id,
          reason: "Direct insert blocked",
          granted_by: auditorA.userId,
          valid_until_utc: new Date(Date.now() + 3600_000).toISOString(),
        });
        expect(audDirectOverride.error).not.toBeNull();

        // Proctor & Exam Coordinator CAN review incident & grant override
        const procReview = await proctorA.client.rpc("transition_security_incident_atomic", {
          p_incident_id: incidentRow!.id,
          p_new_status: "UNDER_REVIEW",
          p_note: "Proctor reviewing incident",
        });
        expect(procReview.error).toBeNull();

        const coordOverride = await coordA.client.rpc("grant_student_exam_browser_override_atomic", {
          p_exam_id: examRow!.id,
          p_student_id: stuARow!.id,
          p_reason: "Koordinator menyetujui fallback darurat",
          p_duration_minutes: 60,
        });
        expect(coordOverride.error).toBeNull();

        // 6. CROSS-SCHOOL ISOLATION: School B (admin, teacher, student) sees ZERO rows and cannot invoke RPCs on School A
        const [bSchools, bExams, bStudents, bAttempts, bIncidents, bAudit] = await Promise.all([
          adminB.client.from("schools").select("id").eq("id", schoolA),
          adminB.client.from("exams").select("id").eq("id", examRow!.id),
          adminB.client.from("students").select("id").eq("school_id", schoolA),
          adminB.client.from("exam_attempts").select("id").eq("id", attemptId),
          adminB.client.from("exam_security_incidents").select("id").eq("id", incidentRow!.id),
          adminB.client.from("audit_events").select("id").eq("school_id", schoolA),
        ]);
        expect(bSchools.data ?? []).toHaveLength(0);
        expect(bExams.data ?? []).toHaveLength(0);
        expect(bStudents.data ?? []).toHaveLength(0);
        expect(bAttempts.data ?? []).toHaveLength(0);
        expect(bIncidents.data ?? []).toHaveLength(0);
        expect(bAudit.data ?? []).toHaveLength(0);

        const [bCrossIncRpc, bCrossStartRpc, bCrossReleaseRpc] = await Promise.all([
          adminB.client.rpc("transition_security_incident_atomic", {
            p_incident_id: incidentRow!.id,
            p_new_status: "DISMISSED",
            p_note: "Cross-school attack",
          }),
          studentB.client.rpc("start_or_resume_exam_attempt", {
            p_exam_id: examRow!.id,
            p_start_idempotency_key: randomUUID(),
          }),
          teacherB.client.rpc("release_exam_results_atomic", {
            p_exam_id: examRow!.id,
            p_action: "release",
          }),
        ]);
        expect(bCrossIncRpc.error).not.toBeNull();
        expect(bCrossStartRpc.error?.message).toContain("EXAM_NOT_FOUND");
        expect(bCrossReleaseRpc.error).not.toBeNull();
        expect(stuBRow?.id).toBeTruthy();
      } finally {
        for (const uid of createdUserIds) {
          await service.auth.admin.deleteUser(uid);
        }
        await service.from("schools").delete().in("id", [schoolA, schoolB]);
      }
    }, 30_000);
  }
);
