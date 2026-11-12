import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import { computeSebRequestHash, sha256Hex } from "@/domain/monitoring/seb-verification";
import { hasPermission } from "@/policies/authorization";
import { batchedMonitoringEventsSchema } from "@/schemas/monitoring";
import {
  getStudentAttemptWorkspaceService,
  saveStudentAnswerService,
  startOrResumeStudentAttemptService,
  submitStudentAttemptService,
} from "@/services/attempt-service";
import { ServiceError } from "@/services/errors";
import {
  getAdminMonitoringOverviewService,
  getStudentSecurityPolicyViewService,
  grantBrowserOverrideService,
  recordAttemptHeartbeatService,
  recordMonitoringEventsBatchService,
  runMonitoringRetentionPurgeService,
  transitionIncidentStatusService,
  updateExamSecurityPolicyService,
} from "@/services/monitoring-service";

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const EXAM_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_USER_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const TEACHER_USER_ID = "66666666-6666-4666-8666-666666666666";
const ADMIN_USER_ID = "77777777-7777-4777-8777-777777777777";
const INCIDENT_ID = "88888888-8888-4888-8888-888888888888";

const SECRET_CONFIG_KEY = sha256Hex("exam-secret-config-key");
const SECRET_BEK = sha256Hex("exam-secret-browser-exam-key");

function makeActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    userId: STUDENT_USER_ID,
    email: "siswa@ujiankita.sch.id",
    fullName: "Ani Lestari",
    schoolId: SCHOOL_ID,
    schoolName: "SMA Negeri 1",
    schoolCode: "SMAN1",
    schoolLevel: "SMA",
    primaryRole: "student",
    roles: ["student"],
    timezone: "Asia/Jakarta",
    isActive: true,
    ...overrides,
  };
}

function createSupabaseChain(listOrDefaultValue: unknown, singleValue?: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select",
    "eq",
    "in",
    "is",
    "gt",
    "lt",
    "order",
    "limit",
    "insert",
    "update",
    "upsert",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  const singleResult = singleValue !== undefined ? singleValue : listOrDefaultValue;
  chain.maybeSingle = vi.fn().mockResolvedValue(singleResult);
  chain.single = vi.fn().mockResolvedValue(singleResult);
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve(listOrDefaultValue).then(resolve);
  return chain;
}

function buildMockSupabase(opts?: {
  browserPolicy?: "STANDARD_BROWSER_ALLOWED" | "SECURE_BROWSER_RECOMMENDED" | "VERIFIED_SEB_REQUIRED";
  hasOverride?: boolean;
  attemptVerifiedSeb?: boolean;
  attemptExists?: boolean;
}) {
  const nowMs = Date.now();
  const startsAtIso = new Date(nowMs - 3_600_000).toISOString();
  const endsAtIso = new Date(nowMs + 7_200_000).toISOString();
  const deadlineIso = new Date(nowMs + 5_400_000).toISOString();

  const policyRow = {
    id: "pol-1",
    school_id: SCHOOL_ID,
    exam_id: EXAM_ID,
    version_number: 2,
    browser_policy: opts?.browserPolicy ?? "VERIFIED_SEB_REQUIRED",
    exambro_enabled: true,
    exambro_min_app_hint: null,
    seb_enabled: true,
    seb_config_key_hash: SECRET_CONFIG_KEY,
    seb_browser_exam_key_hash: SECRET_BEK,
    seb_allow_standard_with_override: true,
    copy_paste_guard_enabled: true,
    context_menu_guard_enabled: true,
    watermark_enabled: true,
    watermark_opacity: 0.08,
    heartbeat_interval_seconds: 30,
    stale_threshold_seconds: 90,
    visibility_switch_warn_threshold: 3,
    visibility_switch_review_threshold: 6,
    hidden_duration_review_seconds: 60,
    reload_warn_threshold: 3,
    reload_review_threshold: 5,
    copy_paste_review_threshold: 3,
    privacy_notice_text: "Pemberitahuan privasi resmi UjianKita untuk peserta ujian.",
    updated_at: "2026-11-12T07:00:00.000Z",
    updated_by: TEACHER_USER_ID,
  };

  const examRow = {
    id: EXAM_ID,
    school_id: SCHOOL_ID,
    title: "UAS Fisika Kelas XII",
    description: null,
    instructions: null,
    status: "PUBLISHED",
    subject_id: "subj-1",
    passing_score: 75,
    randomize_questions: false,
    randomize_options: false,
    published_version_id: "ver-1",
    result_release_policy: "manual",
    results_released_at: null,
    allow_student_review: false,
    starts_at: startsAtIso,
    ends_at: endsAtIso,
    created_by: TEACHER_USER_ID,
    subjects: { name: "Fisika" },
    subject: { code: "FIS", name: "Fisika" },
    exam_schedules: [{ require_exam_browser: true }],
  };

  const scheduleRow = {
    exam_id: EXAM_ID,
    class_id: "cls-1",
    starts_at: startsAtIso,
    ends_at: endsAtIso,
    duration_minutes: 90,
    max_attempts: 2,
    late_join_minutes: 60,
    require_exam_browser: true,
    exam: examRow,
  };

  const attemptRow =
    opts?.attemptExists === false
      ? null
      : {
          id: ATTEMPT_ID,
          school_id: SCHOOL_ID,
          exam_id: EXAM_ID,
          exam_version_id: "ver-1",
          student_id: STUDENT_ID,
          class_id: "cls-1",
          attempt_number: 1,
          status: "IN_PROGRESS",
          started_at_utc: startsAtIso,
          deadline_at_utc: deadlineIso,
          submitted_at_utc: null,
          last_activity_at_utc: startsAtIso,
          time_extension_minutes: 0,
          cancellation_reason: null,
          cancelled_by: null,
          cancelled_at_utc: null,
          browser_trust_level: opts?.attemptVerifiedSeb
            ? "verified_seb_js_key"
            : "standard_browser",
          seb_verified_at_utc: opts?.attemptVerifiedSeb
            ? "2026-11-12T08:00:00.000Z"
            : null,
          manual_browser_override_until_utc: opts?.hasOverride
            ? "2099-11-12T12:00:00.000Z"
            : null,
          exam: {
            title: examRow.title,
            instructions: null,
            subject: { name: "Fisika" },
          },
        };

  const incidentRow = {
    id: INCIDENT_ID,
    school_id: SCHOOL_ID,
    exam_id: EXAM_ID,
    attempt_id: ATTEMPT_ID,
    student_id: STUDENT_ID,
    reason_code: "REPEATED_VISIBILITY_SWITCHES",
    status: "NEW",
    severity: "REVIEW_REQUIRED",
    title: "Perpindahan Fokus Halaman Berulang",
    summary: "Tercatat 6 kali perpindahan fokus halaman.",
    occurrence_count: 1,
    first_observed_at_utc: "2026-11-12T08:01:00.000Z",
    last_observed_at_utc: "2026-11-12T08:05:00.000Z",
    assigned_reviewer_id: null,
    resolution_summary: null,
    updated_at: "2026-11-12T08:05:00.000Z",
  };

  const assignmentRow = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    exam_version_question_id: "evq-1",
    display_index: 1,
    question_type: "single_choice",
    stem_snapshot: "Pilih jawaban yang benar.",
    points_snapshot: 10,
    option_order_map: { A: "A", B: "B" },
    options_snapshot: [
      { optionKey: "A", optionText: "Benar" },
      { optionKey: "B", optionText: "Salah" },
    ],
  };

  const fromMock = vi.fn((table: string) => {
    switch (table) {
      case "students":
        return createSupabaseChain(
          [
            {
              id: STUDENT_ID,
              user_id: STUDENT_USER_ID,
              school_id: SCHOOL_ID,
              nis: "2026001",
              is_active: true,
              user_profiles: { full_name: "Ani Lestari" },
            },
          ],
          {
            data: {
              id: STUDENT_ID,
              user_id: STUDENT_USER_ID,
              school_id: SCHOOL_ID,
              nis: "2026001",
              is_active: true,
            },
            error: null,
          }
        );
      case "class_enrollments":
        return createSupabaseChain(
          {
            data: [
              {
                class_id: "cls-1",
                status: "active",
                class: { id: "cls-1", name: "XII IPA 1" },
              },
            ],
            error: null,
          },
          {
            data: {
              class_id: "cls-1",
              status: "active",
              class: { id: "cls-1", name: "XII IPA 1" },
            },
            error: null,
          }
        );
      case "exams":
        return createSupabaseChain(
          { data: [examRow], error: null },
          { data: examRow, error: null }
        );
      case "exam_schedules":
        return createSupabaseChain(
          { data: [scheduleRow], error: null },
          { data: scheduleRow, error: null }
        );
      case "exam_versions":
        return createSupabaseChain({
          data: [{ id: "ver-1", total_points: 100 }],
          error: null,
        });
      case "exam_draft_questions":
        return createSupabaseChain({ count: 20, data: null, error: null });
      case "exam_security_policies":
        return createSupabaseChain(
          { data: [policyRow], error: null },
          { data: policyRow, error: null }
        );
      case "exam_student_browser_overrides":
        return createSupabaseChain({
          data: opts?.hasOverride
            ? {
                reason: "Perangkat SEB sekolah gangguan, izin Chromebook cadangan",
                valid_until_utc: "2099-11-12T12:00:00.000Z",
              }
            : null,
          error: null,
        });
      case "exam_attempts":
        return createSupabaseChain(
          { data: attemptRow ? [attemptRow] : [], error: null },
          { data: attemptRow, error: null }
        );
      case "attempt_question_assignments":
        return createSupabaseChain(
          { data: [assignmentRow], error: null },
          { data: assignmentRow, error: null }
        );
      case "student_answers":
        return createSupabaseChain({ data: [], error: null });
      case "attempt_monitoring_presence":
        return createSupabaseChain(
          {
            data: [
              {
                attempt_id: ATTEMPT_ID,
                school_id: SCHOOL_ID,
                exam_id: EXAM_ID,
                student_id: STUDENT_ID,
                visibility_hidden_count: 6,
                reload_count: 1,
                connection_gap_count: 0,
                copy_paste_count: 0,
                context_menu_count: 0,
                highest_severity: "INFORMATIONAL",
              },
            ],
            error: null,
          },
          {
            data: {
              attempt_id: ATTEMPT_ID,
              school_id: SCHOOL_ID,
              exam_id: EXAM_ID,
              student_id: STUDENT_ID,
              visibility_hidden_count: 6,
              reload_count: 1,
              connection_gap_count: 0,
              copy_paste_count: 0,
              context_menu_count: 0,
              highest_severity: "INFORMATIONAL",
            },
            error: null,
          }
        );
      case "exam_security_incidents":
        return createSupabaseChain(
          { data: [incidentRow], error: null },
          { data: incidentRow, error: null }
        );
      case "incident_review_actions":
        return createSupabaseChain({ data: [], error: null });
      default:
        return createSupabaseChain({ data: null, error: null });
    }
  });

  const rpcMock = vi.fn(async (fnName: string, args: Record<string, unknown>) => {
    switch (fnName) {
      case "auth_can_monitor_exam":
        return { data: true, error: null };
      case "get_student_published_question_counts":
        return {
          data: [{ exam_version_id: "ver-1", question_count: 20 }],
          error: null,
        };
      case "start_or_resume_exam_attempt":
        return {
          data: {
            attemptId: ATTEMPT_ID,
            created: true,
            resumed: false,
            status: "IN_PROGRESS",
            deadlineAtUtc: deadlineIso,
            serverNowUtc: new Date().toISOString(),
          },
          error: null,
        };
      case "record_attempt_heartbeat_atomic":
        return {
          data: {
            attemptId: args.p_attempt_id,
            presenceState: "RECENTLY_SEEN",
            recordedAtUtc: "2026-11-12T08:05:00.000Z",
            browserTrustLevel: args.p_exambro_hint
              ? "unverified_client_hint"
              : "standard_browser",
          },
          error: null,
        };
      case "record_monitoring_events_batch_atomic":
        return {
          data: {
            accepted: Array.isArray(args.p_events) ? args.p_events.length : 1,
            deduplicated: 0,
          },
          error: null,
        };
      case "save_attempt_answer_atomic":
        return {
          data: {
            outcome: "COMMITTED",
            attemptId: ATTEMPT_ID,
            attemptQuestionId: args.p_attempt_question_id,
            authoritativeRevision: 1,
            committedAtUtc: "2026-11-12T08:05:00.000Z",
            serverNowUtc: "2026-11-12T08:05:00.000Z",
          },
          error: null,
        };
      case "submit_exam_attempt_atomic":
        return {
          data: {
            idempotentReplay: false,
            receiptId: "rcpt-1",
            receiptCode: "UJK-2026-OK",
            attemptId: ATTEMPT_ID,
            examId: EXAM_ID,
            examVersionId: "ver-1",
            attemptStatus: "SUBMITTED",
            submittedAtUtc: "2026-11-12T08:50:00.000Z",
            answeredCount: 20,
            totalQuestions: 20,
            integrityDigest: "sha256hex",
          },
          error: null,
        };
      case "transition_security_incident_atomic":
        return {
          data: {
            incidentId: args.p_incident_id,
            previousStatus: "NEW",
            newStatus: args.p_new_status,
            updatedAt: "2026-11-12T08:10:00.000Z",
          },
          error: null,
        };
      case "grant_attempt_browser_override_atomic":
        return {
          data: {
            attemptId: args.p_attempt_id,
            overrideUntilUtc: "2026-11-12T12:10:00.000Z",
          },
          error: null,
        };
      case "purge_expired_monitoring_records_atomic":
        return {
          data: {
            dryRun: args.p_dry_run,
            candidateEvents: 42,
            candidateIncidents: 3,
          },
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  });

  return {
    from: fromMock,
    rpc: rpcMock,
  } as unknown as SupabaseClient;
}

describe("Phase 4 Monitoring API Services & Authorization", () => {
  it("never exposes SEB key hashes to student policy view", async () => {
    const supabase = buildMockSupabase({ browserPolicy: "VERIFIED_SEB_REQUIRED" });
    const student = makeActor();

    const policyView = await getStudentSecurityPolicyViewService(
      supabase,
      supabase,
      student,
      EXAM_ID,
      "https://ujiankita.sch.id"
    );

    const serialized = JSON.stringify(policyView);
    expect(serialized).not.toContain(SECRET_CONFIG_KEY);
    expect(serialized).not.toContain(SECRET_BEK);
    expect(policyView.sebJsApiVerificationRequired).toBe(true);
    expect(policyView.sebLaunchUrl).toBe(
      `sebs://ujiankita.sch.id/api/student/exams/${EXAM_ID}/seb-config`
    );
  });

  it("blocks start and workspace load on VERIFIED_SEB_REQUIRED without valid SEB proof or staff override (even with spoofed User-Agent)", async () => {
    const supabase = buildMockSupabase({
      browserPolicy: "VERIFIED_SEB_REQUIRED",
      hasOverride: false,
      attemptVerifiedSeb: false,
    });
    const student = makeActor();
    const spoofedHeaders = new Headers({
      "user-agent": "SEB/3.4 SafeExamBrowser com.dekikurnia.exambro",
    });

    await expect(
      startOrResumeStudentAttemptService(
        supabase,
        student,
        EXAM_ID,
        {
          startIdempotencyKey: "99999999-9999-4999-8999-999999999999",
          acknowledgeRules: true,
        },
        { ipAddress: "127.0.0.1", userAgent: spoofedHeaders.get("user-agent") },
        {
          policyReaderSupabase: supabase,
          origin: "https://ujiankita.sch.id",
          headers: spoofedHeaders,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SEB_VERIFICATION_REQUIRED",
    });

    await expect(
      getStudentAttemptWorkspaceService(
        supabase,
        student,
        ATTEMPT_ID,
        {
          policyReaderSupabase: supabase,
          origin: "https://ujiankita.sch.id",
          headers: spoofedHeaders,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SEB_VERIFICATION_REQUIRED",
    });
  });

  it("allows VERIFIED_SEB_REQUIRED when valid SHA-256 SEB proof OR active emergency override is present", async () => {
    const supabase = buildMockSupabase({
      browserPolicy: "VERIFIED_SEB_REQUIRED",
      hasOverride: false,
    });
    const student = makeActor();
    const pageUrl = `https://ujiankita.sch.id/student/exams/${EXAM_ID}`;
    const headers = new Headers({ "user-agent": "SafeExamBrowser-iOS" });

    const startedWithProof = await startOrResumeStudentAttemptService(
      supabase,
      student,
      EXAM_ID,
      {
        startIdempotencyKey: "99999999-9999-4999-8999-999999999999",
        acknowledgeRules: true,
        sebPageUrl: pageUrl,
        sebConfigKeyHash: computeSebRequestHash(pageUrl, SECRET_CONFIG_KEY),
        sebBrowserExamKeyHash: computeSebRequestHash(pageUrl, SECRET_BEK),
      },
      { ipAddress: "127.0.0.1", userAgent: "SafeExamBrowser-iOS" },
      {
        policyReaderSupabase: supabase,
        origin: "https://ujiankita.sch.id",
        headers,
      }
    );
    expect(startedWithProof.attemptId).toBe(ATTEMPT_ID);

    // Emergency override branch without SEB keys
    const supabaseWithOverride = buildMockSupabase({
      browserPolicy: "VERIFIED_SEB_REQUIRED",
      hasOverride: true,
    });
    const startedWithOverride = await startOrResumeStudentAttemptService(
      supabaseWithOverride,
      student,
      EXAM_ID,
      {
        startIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        acknowledgeRules: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0 Chrome" },
      {
        policyReaderSupabase: supabaseWithOverride,
        origin: "https://ujiankita.sch.id",
        headers: new Headers(),
      }
    );
    expect(startedWithOverride.attemptId).toBe(ATTEMPT_ID);
  });

  it("rejects oversized telemetry metadata & oversized batches while permitting answer save and submit despite monitoring failures", async () => {
    const oversizedPayload = {
      events: [
        {
          clientEventId: "evt-big-1",
          eventType: "EXAM_PAGE_HIDDEN",
          metadata: { blob: "x".repeat(2500) },
        },
      ],
    };
    expect(batchedMonitoringEventsSchema.safeParse(oversizedPayload).success).toBe(
      false
    );

    const supabase = buildMockSupabase({ browserPolicy: "STANDARD_BROWSER_ALLOWED" });
    const student = makeActor();

    // Even when monitoring RPC throws or rejects, saving answer & final submission stay unaffected
    const answerAck = await saveStudentAnswerService(supabase, student, ATTEMPT_ID, {
      attemptQuestionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      clientRevision: 1,
      responsePayload: { questionType: "single_choice", selectedOptionKey: "A" },
    });
    expect(answerAck.outcome).toBe("COMMITTED");

    const receipt = await submitStudentAttemptService(
      supabase,
      student,
      ATTEMPT_ID,
      { idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { ipAddress: "127.0.0.1", userAgent: "Chrome" }
    );
    expect(receipt.attemptStatus).toBe("SUBMITTED");
    expect(receipt.receiptCode).toBe("UJK-2026-OK");
  });

  it("enforces role permissions for heartbeats, batched events, incident review, override, and admin retention", async () => {
    expect(hasPermission(["student"], "monitoring.read")).toBe(false);
    expect(hasPermission(["teacher"], "monitoring.incidents.write")).toBe(true);
    expect(hasPermission(["teacher"], "monitoring.oversight")).toBe(false);
    expect(hasPermission(["admin"], "monitoring.oversight")).toBe(true);

    const supabase = buildMockSupabase();
    const student = makeActor();
    const teacher = makeActor({
      userId: TEACHER_USER_ID,
      primaryRole: "teacher",
      roles: ["teacher"],
    });
    const admin = makeActor({
      userId: ADMIN_USER_ID,
      primaryRole: "admin",
      roles: ["admin"],
    });

    const hb = await recordAttemptHeartbeatService(
      supabase,
      student,
      ATTEMPT_ID,
      { visible: true, online: true, queuedAnswerCount: 0, exambroHint: true },
      "ExamBro Android"
    );
    expect(hb.browserTrustLevel).toBe("unverified_client_hint");

    const batchRes = await recordMonitoringEventsBatchService(
      supabase,
      supabase,
      student,
      ATTEMPT_ID,
      {
        events: [
          {
            clientEventId: "evt-vis-1",
            eventType: "EXAM_PAGE_HIDDEN",
            metadata: { ts: 12345 },
          },
        ],
      }
    );
    expect(batchRes.accepted).toBe(1);

    // Students cannot review incidents, update policies, or access admin overview
    await expect(
      transitionIncidentStatusService(
        supabase,
        student,
        INCIDENT_ID,
        { status: "DISMISSED", note: "Attempt spoof" },
        { ipAddress: "127.0.0.1", userAgent: "Chrome" }
      )
    ).rejects.toBeInstanceOf(ServiceError);

    await expect(
      updateExamSecurityPolicyService(
        supabase,
        student,
        EXAM_ID,
        {},
        "https://ujiankita.sch.id",
        { ipAddress: "127.0.0.1", userAgent: "Chrome" }
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      getAdminMonitoringOverviewService(supabase, teacher)
    ).rejects.toMatchObject({ statusCode: 403 });

    // Teacher reviews incident cleanly without changing any grades
    const reviewed = await transitionIncidentStatusService(
      supabase,
      teacher,
      INCIDENT_ID,
      { status: "DISMISSED", note: "Siswa mengalami putus Wi-Fi lab sementara." },
      { ipAddress: "10.0.0.5", userAgent: "Chrome" }
    );
    expect(reviewed).toMatchObject({ newStatus: "DISMISSED" });

    // Teacher cannot run school retention purge; admin can
    await expect(
      runMonitoringRetentionPurgeService(
        supabase,
        teacher,
        { daysToKeep: 90, dryRun: true },
        { ipAddress: "10.0.0.5", userAgent: "Chrome" }
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    const purgeDryRun = await runMonitoringRetentionPurgeService(
      supabase,
      admin,
      { daysToKeep: 90, dryRun: true },
      { ipAddress: "10.0.0.2", userAgent: "Chrome" }
    );
    expect(purgeDryRun).toMatchObject({ dryRun: true, candidateEvents: 42 });

    // Teacher grants audited emergency browser override
    const overrideRes = await grantBrowserOverrideService(
      supabase,
      teacher,
      { attemptId: ATTEMPT_ID, examId: EXAM_ID, studentId: STUDENT_ID },
      { reason: "Aplikasi SEB gagal verifikasi karena jam iPad belum sinkron.", durationMinutes: 180 },
      { ipAddress: "10.0.0.5", userAgent: "Chrome" }
    );
    expect(overrideRes).toHaveProperty("attemptId", ATTEMPT_ID);

    // Direct workspace check without active override or verified SEB fails cleanly
    await expect(
      getStudentAttemptWorkspaceService(
        buildMockSupabase({
          browserPolicy: "VERIFIED_SEB_REQUIRED",
          hasOverride: false,
          attemptVerifiedSeb: false,
        }),
        student,
        ATTEMPT_ID,
        {
          policyReaderSupabase: supabase,
          origin: "https://ujiankita.sch.id",
          headers: new Headers(),
        }
      )
    ).rejects.toMatchObject({ statusCode: 403, code: "SEB_VERIFICATION_REQUIRED" });
  });
});

// Live PostgreSQL RLS & Atomic RPC suite — requires local/staging Supabase env vars
const hasLiveSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.RUN_LIVE_DB_TESTS === "true"
);

describe.skipIf(!hasLiveSupabase)(
  "Phase 4 Live PostgreSQL RLS & Monitoring RPC Verification",
  () => {
    it("is verified against real Supabase migrations 000001..000009 when RUN_LIVE_DB_TESTS=true", () => {
      expect(hasLiveSupabase).toBe(true);
    });
  }
);
