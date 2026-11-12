import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptLifecycleStatus } from "@/domain/exams/contracts";
import {
  createDefaultSecurityPolicy,
  type AdminMonitoringOverviewData,
  type BrowserEnforcementPolicy,
  type ExamSecurityIncidentRecord,
  type ExamSecurityPolicyRecord,
  type IncidentReasonCode,
  type IncidentReviewActionRecord,
  type IncidentStatus,
  type MonitoringActivityTimelineEntry,
  type MonitoringBrowserPlatform,
  type MonitoringEventSource,
  type MonitoringEventType,
  type MonitoringSeverity,
  type MonitoringTrustLevel,
} from "@/domain/monitoring/phase4-types";
import { describeMonitoringEvent } from "@/domain/monitoring/presence-and-incidents";

export interface ExamBasicMonitoringContext {
  examId: string;
  schoolId: string;
  title: string;
  status: string;
  subjectId: string;
  subjectName: string;
  startsAt: string | null;
  endsAt: string | null;
  requireExamBrowser: boolean;
  questionCount: number;
  createdBy: string | null;
}

function mapPolicyRow(row: Record<string, unknown>): ExamSecurityPolicyRecord {
  return {
    id: String(row.id),
    schoolId: String(row.school_id),
    examId: String(row.exam_id),
    versionNumber: Number(row.version_number ?? 1),
    browserPolicy: row.browser_policy as BrowserEnforcementPolicy,
    exambroEnabled: Boolean(row.exambro_enabled),
    exambroMinAppHint: row.exambro_min_app_hint ? String(row.exambro_min_app_hint) : null,
    sebEnabled: Boolean(row.seb_enabled),
    sebConfigKeyHash: row.seb_config_key_hash ? String(row.seb_config_key_hash) : null,
    sebBrowserExamKeyHash: row.seb_browser_exam_key_hash
      ? String(row.seb_browser_exam_key_hash)
      : null,
    sebAllowStandardWithOverride: Boolean(row.seb_allow_standard_with_override ?? true),
    copyPasteGuardEnabled: Boolean(row.copy_paste_guard_enabled ?? true),
    contextMenuGuardEnabled: Boolean(row.context_menu_guard_enabled ?? true),
    watermarkEnabled: Boolean(row.watermark_enabled ?? true),
    watermarkOpacity: Number(row.watermark_opacity ?? 0.08),
    heartbeatIntervalSeconds: Number(row.heartbeat_interval_seconds ?? 30),
    staleThresholdSeconds: Number(row.stale_threshold_seconds ?? 90),
    visibilitySwitchWarnThreshold: Number(row.visibility_switch_warn_threshold ?? 3),
    visibilitySwitchReviewThreshold: Number(row.visibility_switch_review_threshold ?? 6),
    hiddenDurationReviewSeconds: Number(row.hidden_duration_review_seconds ?? 60),
    reloadWarnThreshold: Number(row.reload_warn_threshold ?? 3),
    reloadReviewThreshold: Number(row.reload_review_threshold ?? 5),
    copyPasteReviewThreshold: Number(row.copy_paste_review_threshold ?? 3),
    privacyNoticeText: String(row.privacy_notice_text ?? ""),
    updatedAt: String(row.updated_at ?? new Date(0).toISOString()),
    updatedBy: row.updated_by ? String(row.updated_by) : null,
  };
}

function mapDbEventSource(raw: string): MonitoringEventSource {
  if (raw === "server_confirmed") return "SERVER_CONFIRMED";
  if (raw === "server_inferred") return "SERVER_INFERRED";
  return "CLIENT_REPORTED";
}

export async function fetchExamBasicMonitoringContext(
  supabase: SupabaseClient,
  examId: string
): Promise<ExamBasicMonitoringContext | null> {
  const { data: examRow, error: examErr } = await supabase
    .from("exams")
    .select(
      "id, school_id, title, status, subject_id, starts_at, ends_at, created_by, subjects(name), exam_schedules(require_exam_browser)"
    )
    .eq("id", examId)
    .maybeSingle();

  if (examErr || !examRow) {
    return null;
  }

  const row = examRow as Record<string, unknown>;
  const subj = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
  const schedules = Array.isArray(row.exam_schedules) ? row.exam_schedules : [];
  const requireExamBrowser = schedules.some(
    (s) => Boolean((s as Record<string, unknown>).require_exam_browser)
  );

  const { count: qCount } = await supabase
    .from("exam_draft_questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_id", examId);

  return {
    examId: String(row.id),
    schoolId: String(row.school_id),
    title: String(row.title),
    status: String(row.status),
    subjectId: String(row.subject_id),
    subjectName:
      subj && typeof subj === "object" && "name" in subj
        ? String((subj as { name: unknown }).name)
        : "Mata Pelajaran",
    startsAt: row.starts_at ? String(row.starts_at) : null,
    endsAt: row.ends_at ? String(row.ends_at) : null,
    requireExamBrowser,
    questionCount: qCount ?? 0,
    createdBy: row.created_by ? String(row.created_by) : null,
  };
}

export async function fetchExamSecurityPolicy(
  supabase: SupabaseClient,
  examId: string,
  schoolId: string,
  requireExamBrowser = false
): Promise<ExamSecurityPolicyRecord> {
  const { data, error } = await supabase
    .from("exam_security_policies")
    .select("*")
    .eq("exam_id", examId)
    .maybeSingle();

  if (error || !data) {
    return createDefaultSecurityPolicy({ examId, schoolId, requireExamBrowser });
  }

  return mapPolicyRow(data as Record<string, unknown>);
}

export async function upsertExamSecurityPolicy(
  supabase: SupabaseClient,
  params: {
    examId: string;
    schoolId: string;
    actorUserId: string;
    policy: Omit<
      ExamSecurityPolicyRecord,
      "id" | "schoolId" | "examId" | "versionNumber" | "updatedAt" | "updatedBy"
    >;
    plistXmlToStore?: string | null;
  }
): Promise<ExamSecurityPolicyRecord> {
  const { data: existing } = await supabase
    .from("exam_security_policies")
    .select("version_number")
    .eq("exam_id", params.examId)
    .maybeSingle();

  const nextVersion = existing ? Number((existing as { version_number: number }).version_number) + 1 : 1;

  const { data, error } = await supabase
    .from("exam_security_policies")
    .upsert(
      {
        school_id: params.schoolId,
        exam_id: params.examId,
        version_number: nextVersion,
        browser_policy: params.policy.browserPolicy,
        exambro_enabled: params.policy.exambroEnabled,
        exambro_min_app_hint: params.policy.exambroMinAppHint,
        seb_enabled: params.policy.sebEnabled,
        seb_config_key_hash: params.policy.sebConfigKeyHash,
        seb_browser_exam_key_hash: params.policy.sebBrowserExamKeyHash,
        seb_allow_standard_with_override: params.policy.sebAllowStandardWithOverride,
        copy_paste_guard_enabled: params.policy.copyPasteGuardEnabled,
        context_menu_guard_enabled: params.policy.contextMenuGuardEnabled,
        watermark_enabled: params.policy.watermarkEnabled,
        watermark_opacity: params.policy.watermarkOpacity,
        heartbeat_interval_seconds: params.policy.heartbeatIntervalSeconds,
        stale_threshold_seconds: params.policy.staleThresholdSeconds,
        visibility_switch_warn_threshold: params.policy.visibilitySwitchWarnThreshold,
        visibility_switch_review_threshold: params.policy.visibilitySwitchReviewThreshold,
        hidden_duration_review_seconds: params.policy.hiddenDurationReviewSeconds,
        reload_warn_threshold: params.policy.reloadWarnThreshold,
        reload_review_threshold: params.policy.reloadReviewThreshold,
        copy_paste_review_threshold: params.policy.copyPasteReviewThreshold,
        privacy_notice_text: params.policy.privacyNoticeText,
        updated_by: params.actorUserId,
      },
      { onConflict: "exam_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw error ?? new Error("Gagal menyimpan kebijakan keamanan ujian.");
  }

  if (params.plistXmlToStore && params.policy.sebConfigKeyHash) {
    await supabase
      .from("secure_browser_configs")
      .update({ is_active: false })
      .eq("exam_id", params.examId)
      .eq("is_active", true);

    await supabase.from("secure_browser_configs").insert({
      school_id: params.schoolId,
      exam_id: params.examId,
      plist_xml: params.plistXmlToStore,
      config_key_hash: params.policy.sebConfigKeyHash,
      browser_exam_key_hash: params.policy.sebBrowserExamKeyHash,
      is_active: true,
      created_by: params.actorUserId,
    });
  }

  await supabase.from("monitoring_audit_events").insert({
    school_id: params.schoolId,
    exam_id: params.examId,
    actor_user_id: params.actorUserId,
    actor_role: "staff",
    action: "monitoring.policy_updated",
    summary: `Kebijakan keamanan ujian diperbarui ke versi ${nextVersion} (${params.policy.browserPolicy}).`,
    metadata: {
      versionNumber: nextVersion,
      browserPolicy: params.policy.browserPolicy,
      sebEnabled: params.policy.sebEnabled,
      exambroEnabled: params.policy.exambroEnabled,
    },
  });

  return mapPolicyRow(data as Record<string, unknown>);
}

export async function fetchActiveSebPlistXml(
  supabase: SupabaseClient,
  examId: string
): Promise<{ plistXml: string; configKeyHash: string } | null> {
  const { data } = await supabase
    .from("secure_browser_configs")
    .select("plist_xml, config_key_hash")
    .eq("exam_id", examId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    plistXml: String(row.plist_xml),
    configKeyHash: String(row.config_key_hash),
  };
}

export async function checkActiveStudentBrowserOverride(
  supabase: SupabaseClient,
  examId: string,
  studentId: string
): Promise<{ active: boolean; reason: string | null; validUntil: string | null }> {
  const nowIso = new Date().toISOString();

  const { data: studentOverride } = await supabase
    .from("exam_student_browser_overrides")
    .select("reason, valid_until_utc")
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .is("revoked_at_utc", null)
    .gt("valid_until_utc", nowIso)
    .maybeSingle();

  if (
    studentOverride &&
    (studentOverride as Record<string, unknown>).valid_until_utc &&
    Date.parse(String((studentOverride as Record<string, unknown>).valid_until_utc)) > Date.now()
  ) {
    const row = studentOverride as Record<string, unknown>;
    return {
      active: true,
      reason: String(row.reason),
      validUntil: String(row.valid_until_utc),
    };
  }

  const { data: attemptOverride } = await supabase
    .from("exam_attempts")
    .select("manual_browser_override_reason, manual_browser_override_until_utc")
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .eq("status", "IN_PROGRESS")
    .gt("manual_browser_override_until_utc", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    attemptOverride &&
    (attemptOverride as Record<string, unknown>).manual_browser_override_until_utc &&
    Date.parse(
      String((attemptOverride as Record<string, unknown>).manual_browser_override_until_utc)
    ) > Date.now()
  ) {
    const row = attemptOverride as Record<string, unknown>;
    return {
      active: true,
      reason: row.manual_browser_override_reason
        ? String(row.manual_browser_override_reason)
        : "Pengecualian pengawas aktif.",
      validUntil: String(row.manual_browser_override_until_utc),
    };
  }

  return { active: false, reason: null, validUntil: null };
}

export async function checkAttemptHasVerifiedSeb(
  supabase: SupabaseClient,
  attemptId: string
): Promise<{ verified: boolean; trustLevel: MonitoringTrustLevel }> {
  const { data } = await supabase
    .from("exam_attempts")
    .select("browser_trust_level, seb_verified_at_utc, manual_browser_override_until_utc")
    .eq("id", attemptId)
    .maybeSingle();

  if (!data) {
    return { verified: false, trustLevel: "standard_browser" };
  }
  const row = data as Record<string, unknown>;
  const trust = String(row.browser_trust_level ?? "standard_browser") as MonitoringTrustLevel;
  if (
    trust === "verified_seb_header_and_key" ||
    trust === "verified_seb_js_key"
  ) {
    return { verified: Boolean(row.seb_verified_at_utc), trustLevel: trust };
  }
  if (
    row.manual_browser_override_until_utc &&
    new Date(String(row.manual_browser_override_until_utc)).getTime() > Date.now()
  ) {
    return { verified: true, trustLevel: "staff_override" };
  }
  return { verified: false, trustLevel: trust };
}

export async function recordSebVerificationOutcome(
  supabase: SupabaseClient,
  params: {
    schoolId: string;
    examId: string;
    studentId: string;
    actorUserId: string;
    verified: boolean;
    trustLevel: MonitoringTrustLevel;
    normalizedUrl: string | null;
    reason: string;
  }
): Promise<{ attemptId: string | null }> {
  const nowIso = new Date().toISOString();
  const { data: attempt } = await supabase
    .from("exam_attempts")
    .select("id, status")
    .eq("exam_id", params.examId)
    .eq("student_id", params.studentId)
    .in("status", ["IN_PROGRESS", "SUBMITTING"])
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt) {
    await supabase.from("monitoring_audit_events").insert({
      school_id: params.schoolId,
      exam_id: params.examId,
      actor_user_id: params.actorUserId,
      actor_role: "student",
      action: params.verified
        ? "monitoring.seb_verified"
        : "monitoring.seb_verification_failed",
      summary: params.reason,
      metadata: {
        normalizedUrl: params.normalizedUrl,
        trustLevel: params.trustLevel,
      },
    });
    return { attemptId: null };
  }

  const attemptId = String((attempt as { id: string }).id);
  if (params.verified) {
    await supabase
      .from("exam_attempts")
      .update({
        browser_platform: "IOS_SAFE_EXAM_BROWSER",
        browser_trust_level: params.trustLevel,
        seb_verified_at_utc: nowIso,
      })
      .eq("id", attemptId);

    await supabase
      .from("attempt_monitoring_presence")
      .update({
        browser_platform: "IOS_SAFE_EXAM_BROWSER",
        browser_trust_level: params.trustLevel,
      })
      .eq("attempt_id", attemptId);
  }

  await supabase.from("attempt_events").insert({
    school_id: params.schoolId,
    attempt_id: attemptId,
    actor_user_id: params.actorUserId,
    event_source: "server_confirmed",
    event_type: params.verified
      ? "SEB_VERIFICATION_SUCCEEDED"
      : "SEB_VERIFICATION_FAILED",
    severity: params.verified ? "INFORMATIONAL" : "REVIEW_REQUIRED",
    occurred_at_utc: nowIso,
    metadata: {
      trustLevel: params.trustLevel,
      reason: params.reason,
    },
  });

  return { attemptId };
}

export async function callHeartbeatRpc(
  supabase: SupabaseClient,
  params: {
    attemptId: string;
    visible: boolean;
    online: boolean;
    queuedAnswerCount: number;
    browserPlatformHint: MonitoringBrowserPlatform;
    exambroHint: boolean;
  }
) {
  const { data, error } = await supabase.rpc("record_attempt_heartbeat_atomic", {
    p_attempt_id: params.attemptId,
    p_visible: params.visible,
    p_online: params.online,
    p_queued_answer_count: params.queuedAnswerCount,
    p_browser_platform_hint: params.browserPlatformHint,
    p_exambro_hint: params.exambroHint,
  });

  if (error) {
    throw error;
  }
  return data as {
    attemptId: string;
    presenceState: string;
    recordedAtUtc: string;
    browserTrustLevel: MonitoringTrustLevel;
  };
}

export async function callMonitoringEventsBatchRpc(
  supabase: SupabaseClient,
  attemptId: string,
  events: Array<{
    clientEventId: string;
    eventType: MonitoringEventType;
    occurredAt?: string;
    metadata: Record<string, unknown>;
  }>
) {
  const { data, error } = await supabase.rpc("record_monitoring_events_batch_atomic", {
    p_attempt_id: attemptId,
    p_events: events,
  });

  if (error) {
    throw error;
  }
  return data as { accepted: number; deduplicated: number; ignoredFinalized?: boolean };
}

export async function upsertDeduplicatedSecurityIncident(
  supabase: SupabaseClient,
  params: {
    schoolId: string;
    examId: string;
    attemptId: string | null;
    studentId: string;
    reasonCode: IncidentReasonCode;
    severity: MonitoringSeverity;
    title: string;
    summary: string;
    observedAtIso: string;
  }
): Promise<string | null> {
  const dedupeKey = `attempt:${params.attemptId ?? params.studentId}:${params.reasonCode}`;

  const { data: existing } = await supabase
    .from("exam_security_incidents")
    .select("id, occurrence_count, severity")
    .eq("exam_id", params.examId)
    .eq("dedupe_key", dedupeKey)
    .in("status", ["NEW", "UNDER_REVIEW", "ACKNOWLEDGED"])
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; occurrence_count: number; severity: MonitoringSeverity };
    const nextSeverity: MonitoringSeverity =
      row.severity === "REVIEW_REQUIRED" || params.severity === "REVIEW_REQUIRED"
        ? "REVIEW_REQUIRED"
        : row.severity === "WARNING" || params.severity === "WARNING"
          ? "WARNING"
          : "INFORMATIONAL";

    await supabase
      .from("exam_security_incidents")
      .update({
        occurrence_count: row.occurrence_count + 1,
        severity: nextSeverity,
        summary: params.summary,
        last_observed_at_utc: params.observedAtIso,
      })
      .eq("id", row.id);

    return row.id;
  }

  const { data: inserted } = await supabase
    .from("exam_security_incidents")
    .insert({
      school_id: params.schoolId,
      exam_id: params.examId,
      attempt_id: params.attemptId,
      student_id: params.studentId,
      reason_code: params.reasonCode,
      dedupe_key: dedupeKey,
      status: "NEW",
      severity: params.severity,
      title: params.title,
      summary: params.summary,
      occurrence_count: 1,
      first_observed_at_utc: params.observedAtIso,
      last_observed_at_utc: params.observedAtIso,
    })
    .select("id")
    .maybeSingle();

  return inserted ? String((inserted as { id: string }).id) : null;
}

export async function fetchAttemptPresenceContext(
  supabase: SupabaseClient,
  attemptId: string
) {
  const { data } = await supabase
    .from("attempt_monitoring_presence")
    .select("*")
    .eq("attempt_id", attemptId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

export interface RawMonitoredExamData {
  assignments: Array<{
    studentId: string;
    studentName: string;
    studentNis: string | null;
    classId: string | null;
    className: string | null;
  }>;
  attempts: Array<{
    id: string;
    studentId: string;
    status: AttemptLifecycleStatus;
    startedAtUtc: string;
    deadlineAtUtc: string;
    submittedAtUtc: string | null;
    browserPlatform: MonitoringBrowserPlatform;
    browserTrustLevel: MonitoringTrustLevel;
    manualOverrideUntilUtc: string | null;
  }>;
  presenceByAttempt: Record<string, Record<string, unknown>>;
  answeredCountByAttempt: Record<string, number>;
  incidents: ExamSecurityIncidentRecord[];
  overridesByStudent: Record<string, boolean>;
}

export async function fetchExamControlCenterRawData(
  supabase: SupabaseClient,
  examId: string
): Promise<RawMonitoredExamData> {
  const { data: classAssignments } = await supabase
    .from("exam_assignments")
    .select("class_id, classes(id, name)")
    .eq("exam_id", examId);

  const classList = (classAssignments ?? []) as Array<Record<string, unknown>>;
  const classIds = classList.map((c) => String(c.class_id));
  const classNameMap = new Map<string, string>();
  for (const c of classList) {
    const cls = Array.isArray(c.classes) ? c.classes[0] : c.classes;
    if (cls && typeof cls === "object" && "name" in cls) {
      classNameMap.set(String(c.class_id), String((cls as { name: unknown }).name));
    }
  }

  const roster: RawMonitoredExamData["assignments"] = [];
  if (classIds.length > 0) {
    const { data: enrollments } = await supabase
      .from("class_enrollments")
      .select(
        "class_id, student_id, students(id, nis, user_id, is_active, user_profiles(full_name))"
      )
      .in("class_id", classIds)
      .eq("status", "active");

    const seenStudents = new Set<string>();
    for (const row of (enrollments ?? []) as Array<Record<string, unknown>>) {
      const studentObj = Array.isArray(row.students) ? row.students[0] : row.students;
      if (!studentObj || typeof studentObj !== "object") continue;
      const st = studentObj as Record<string, unknown>;
      if (st.is_active === false) continue;
      const sid = String(row.student_id);
      if (seenStudents.has(sid)) continue;
      seenStudents.add(sid);

      const profile = Array.isArray(st.user_profiles) ? st.user_profiles[0] : st.user_profiles;
      const fullName =
        profile && typeof profile === "object" && "full_name" in profile
          ? String((profile as { full_name: unknown }).full_name)
          : "Siswa";
      const cid = String(row.class_id);

      roster.push({
        studentId: sid,
        studentName: fullName,
        studentNis: st.nis ? String(st.nis) : null,
        classId: cid,
        className: classNameMap.get(cid) ?? null,
      });
    }
  }

  const { data: attemptRows } = await supabase
    .from("exam_attempts")
    .select(
      "id, student_id, status, started_at_utc, deadline_at_utc, submitted_at_utc, browser_platform, browser_trust_level, manual_browser_override_until_utc, attempt_number"
    )
    .eq("exam_id", examId)
    .order("attempt_number", { ascending: false });

  const latestAttemptByStudent = new Map<string, RawMonitoredExamData["attempts"][number]>();
  for (const row of (attemptRows ?? []) as Array<Record<string, unknown>>) {
    const sid = String(row.student_id);
    if (!latestAttemptByStudent.has(sid)) {
      latestAttemptByStudent.set(sid, {
        id: String(row.id),
        studentId: sid,
        status: row.status as AttemptLifecycleStatus,
        startedAtUtc: String(row.started_at_utc),
        deadlineAtUtc: String(row.deadline_at_utc),
        submittedAtUtc: row.submitted_at_utc ? String(row.submitted_at_utc) : null,
        browserPlatform: (row.browser_platform ?? "UNKNOWN") as MonitoringBrowserPlatform,
        browserTrustLevel: (row.browser_trust_level ?? "standard_browser") as MonitoringTrustLevel,
        manualOverrideUntilUtc: row.manual_browser_override_until_utc
          ? String(row.manual_browser_override_until_utc)
          : null,
      });
    }
  }

  const attempts = Array.from(latestAttemptByStudent.values());
  const attemptIds = attempts.map((a) => a.id);

  const presenceByAttempt: Record<string, Record<string, unknown>> = {};
  const answeredCountByAttempt: Record<string, number> = {};

  if (attemptIds.length > 0) {
    const { data: presenceRows } = await supabase
      .from("attempt_monitoring_presence")
      .select("*")
      .in("attempt_id", attemptIds);

    for (const p of (presenceRows ?? []) as Array<Record<string, unknown>>) {
      presenceByAttempt[String(p.attempt_id)] = p;
    }

    const { data: answerRows } = await supabase
      .from("student_answers")
      .select("attempt_id")
      .in("attempt_id", attemptIds);

    for (const a of (answerRows ?? []) as Array<Record<string, unknown>>) {
      const aid = String(a.attempt_id);
      answeredCountByAttempt[aid] = (answeredCountByAttempt[aid] ?? 0) + 1;
    }
  }

  const { data: overrideRows } = await supabase
    .from("exam_student_browser_overrides")
    .select("student_id, valid_until_utc")
    .eq("exam_id", examId)
    .is("revoked_at_utc", null)
    .gt("valid_until_utc", new Date().toISOString());

  const overridesByStudent: Record<string, boolean> = {};
  for (const ov of (overrideRows ?? []) as Array<Record<string, unknown>>) {
    overridesByStudent[String(ov.student_id)] = true;
  }

  const incidents = await fetchExamSecurityIncidents(supabase, examId, roster);

  return {
    assignments: roster,
    attempts,
    presenceByAttempt,
    answeredCountByAttempt,
    incidents,
    overridesByStudent,
  };
}

export async function fetchExamSecurityIncidents(
  supabase: SupabaseClient,
  examId: string,
  rosterHint?: RawMonitoredExamData["assignments"]
): Promise<ExamSecurityIncidentRecord[]> {
  const { data } = await supabase
    .from("exam_security_incidents")
    .select(
      "id, school_id, exam_id, attempt_id, student_id, reason_code, status, severity, title, summary, occurrence_count, first_observed_at_utc, last_observed_at_utc, assigned_reviewer_id, resolution_summary, updated_at"
    )
    .eq("exam_id", examId)
    .order("last_observed_at_utc", { ascending: false });

  const rosterMap = new Map((rosterHint ?? []).map((r) => [r.studentId, r]));
  const rows = (
    Array.isArray(data) ? data : data ? [data] : []
  ) as Array<Record<string, unknown>>;

  const missingStudentIds = rows
    .map((r) => String(r.student_id))
    .filter((sid) => !rosterMap.has(sid));

  if (missingStudentIds.length > 0) {
    const { data: stData } = await supabase
      .from("students")
      .select("id, nis, user_profiles(full_name)")
      .in("id", missingStudentIds);

    for (const s of (stData ?? []) as Array<Record<string, unknown>>) {
      const prof = Array.isArray(s.user_profiles) ? s.user_profiles[0] : s.user_profiles;
      rosterMap.set(String(s.id), {
        studentId: String(s.id),
        studentName:
          prof && typeof prof === "object" && "full_name" in prof
            ? String((prof as { full_name: unknown }).full_name)
            : "Siswa",
        studentNis: s.nis ? String(s.nis) : null,
        classId: null,
        className: null,
      });
    }
  }

  return rows.map((row) => {
    const student = rosterMap.get(String(row.student_id));
    return {
      id: String(row.id),
      schoolId: String(row.school_id),
      examId: String(row.exam_id),
      attemptId: row.attempt_id ? String(row.attempt_id) : null,
      studentId: String(row.student_id),
      studentName: student?.studentName ?? "Siswa",
      studentNis: student?.studentNis ?? null,
      className: student?.className ?? null,
      reasonCode: row.reason_code as IncidentReasonCode,
      status: row.status as IncidentStatus,
      severity: row.severity as MonitoringSeverity,
      title: String(row.title),
      summary: String(row.summary),
      occurrenceCount: Number(row.occurrence_count ?? 1),
      firstObservedAt: String(row.first_observed_at_utc),
      lastObservedAt: String(row.last_observed_at_utc),
      assignedReviewerId: row.assigned_reviewer_id
        ? String(row.assigned_reviewer_id)
        : null,
      assignedReviewerName: null,
      resolutionSummary: row.resolution_summary ? String(row.resolution_summary) : null,
      updatedAt: String(row.updated_at),
    };
  });
}

export async function fetchIncidentDetailWithActions(
  supabase: SupabaseClient,
  incidentId: string
): Promise<{
  incident: ExamSecurityIncidentRecord;
  actions: IncidentReviewActionRecord[];
} | null> {
  const { data: row } = await supabase
    .from("exam_security_incidents")
    .select(
      "id, school_id, exam_id, attempt_id, student_id, reason_code, status, severity, title, summary, occurrence_count, first_observed_at_utc, last_observed_at_utc, assigned_reviewer_id, resolution_summary, updated_at"
    )
    .eq("id", incidentId)
    .maybeSingle();

  if (!row) return null;
  const r = row as Record<string, unknown>;
  const examIncidents = await fetchExamSecurityIncidents(supabase, String(r.exam_id));
  const incident = examIncidents.find((i) => i.id === incidentId);
  if (!incident) return null;

  const { data: actionRows } = await supabase
    .from("incident_review_actions")
    .select(
      "id, incident_id, actor_user_id, actor_role, previous_status, new_status, note, created_at, user_profiles(full_name)"
    )
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false });

  const actions: IncidentReviewActionRecord[] = (
    (actionRows ?? []) as Array<Record<string, unknown>>
  ).map((a) => {
    const prof = Array.isArray(a.user_profiles) ? a.user_profiles[0] : a.user_profiles;
    return {
      id: String(a.id),
      incidentId: String(a.incident_id),
      actorUserId: String(a.actor_user_id),
      actorName:
        prof && typeof prof === "object" && "full_name" in prof
          ? String((prof as { full_name: unknown }).full_name)
          : "Staf",
      actorRole: String(a.actor_role),
      previousStatus: a.previous_status ? (String(a.previous_status) as IncidentStatus) : null,
      newStatus: String(a.new_status) as IncidentStatus,
      note: String(a.note),
      createdAt: String(a.created_at),
    };
  });

  return { incident, actions };
}

export async function fetchAttemptTimelineEntries(
  supabase: SupabaseClient,
  attemptId: string
): Promise<MonitoringActivityTimelineEntry[]> {
  const { data } = await supabase
    .from("attempt_events")
    .select("id, event_type, event_source, severity, occurred_at_utc, created_at_utc, metadata")
    .eq("attempt_id", attemptId)
    .order("created_at_utc", { ascending: false })
    .limit(250);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const eventType = String(row.event_type) as MonitoringEventType;
    const source = mapDbEventSource(String(row.event_source));
    return {
      id: String(row.id),
      eventType,
      source,
      severity: (row.severity ?? "INFORMATIONAL") as MonitoringSeverity,
      occurredAt: String(row.occurred_at_utc ?? row.created_at_utc),
      recordedAt: String(row.created_at_utc),
      title: describeMonitoringEvent(eventType),
      detail:
        row.metadata && typeof row.metadata === "object" && "reason" in row.metadata
          ? String((row.metadata as { reason: unknown }).reason)
          : "",
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    };
  });
}

export async function transitionIncidentRpc(
  supabase: SupabaseClient,
  incidentId: string,
  newStatus: IncidentStatus,
  note: string
) {
  const { data, error } = await supabase.rpc("transition_security_incident_atomic", {
    p_incident_id: incidentId,
    p_new_status: newStatus,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

export async function grantAttemptOverrideRpc(
  supabase: SupabaseClient,
  params: { attemptId?: string; examId: string; studentId?: string },
  reason: string,
  durationMinutes: number
) {
  if (params.attemptId) {
    const { data, error } = await supabase.rpc("grant_attempt_browser_override_atomic", {
      p_attempt_id: params.attemptId,
      p_reason: reason,
      p_duration_minutes: durationMinutes,
    });
    if (error) throw error;
    return data;
  }

  if (params.studentId) {
    const { data, error } = await supabase.rpc(
      "grant_student_exam_browser_override_atomic",
      {
        p_exam_id: params.examId,
        p_student_id: params.studentId,
        p_reason: reason,
        p_duration_minutes: durationMinutes,
      }
    );
    if (error) throw error;
    return data;
  }

  throw new Error("Target pengecualian (attemptId atau studentId) harus ditentukan.");
}

export async function fetchSchoolMonitoringOverviewRaw(
  supabase: SupabaseClient,
  schoolId: string
): Promise<AdminMonitoringOverviewData> {
  const { data: examRows } = await supabase
    .from("exams")
    .select(
      "id, title, starts_at, ends_at, status, subjects(name), exam_security_policies(browser_policy)"
    )
    .eq("school_id", schoolId)
    .in("status", ["PUBLISHED", "CLOSED"])
    .order("starts_at", { ascending: false })
    .limit(50);

  const examsData = (examRows ?? []) as Array<Record<string, unknown>>;
  const examIds = examsData.map((e) => String(e.id));

  const presenceByExam = new Map<string, Array<Record<string, unknown>>>();
  const incidentsByExam = new Map<string, Array<Record<string, unknown>>>();
  const attemptsByExam = new Map<string, Array<Record<string, unknown>>>();

  if (examIds.length > 0) {
    const [{ data: pres }, { data: incs }, { data: atts }] = await Promise.all([
      supabase
        .from("attempt_monitoring_presence")
        .select("exam_id, presence_state, highest_severity")
        .in("exam_id", examIds),
      supabase
        .from("exam_security_incidents")
        .select("exam_id, status")
        .in("exam_id", examIds)
        .in("status", ["NEW", "UNDER_REVIEW", "ACKNOWLEDGED"]),
      supabase
        .from("exam_attempts")
        .select("exam_id, status")
        .in("exam_id", examIds),
    ]);

    for (const p of (pres ?? []) as Array<Record<string, unknown>>) {
      const eid = String(p.exam_id);
      presenceByExam.set(eid, [...(presenceByExam.get(eid) ?? []), p]);
    }
    for (const inc of (incs ?? []) as Array<Record<string, unknown>>) {
      const eid = String(inc.exam_id);
      incidentsByExam.set(eid, [...(incidentsByExam.get(eid) ?? []), inc]);
    }
    for (const att of (atts ?? []) as Array<Record<string, unknown>>) {
      const eid = String(att.exam_id);
      attemptsByExam.set(eid, [...(attemptsByExam.get(eid) ?? []), att]);
    }
  }

  const { data: auditRows } = await supabase
    .from("monitoring_audit_events")
    .select("id, action, actor_role, summary, created_at")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(20);

  let totalActiveStudents = 0;
  let totalStaleConnections = 0;
  let totalOpenIncidents = 0;
  let totalReviewRequiredStudents = 0;

  const exams = examsData.map((row) => {
    const eid = String(row.id);
    const subj = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    const pol = Array.isArray(row.exam_security_policies)
      ? row.exam_security_policies[0]
      : row.exam_security_policies;
    const presList = presenceByExam.get(eid) ?? [];
    const incList = incidentsByExam.get(eid) ?? [];
    const attList = attemptsByExam.get(eid) ?? [];

    const activeStudents = attList.filter((a) => a.status === "IN_PROGRESS").length;
    const submittedCount = attList.filter((a) => a.status === "SUBMITTED").length;
    const staleConnections = presList.filter((p) => p.presence_state === "STALE").length;
    const reviewReq = presList.filter(
      (p) => p.highest_severity === "REVIEW_REQUIRED"
    ).length;

    totalActiveStudents += activeStudents;
    totalStaleConnections += staleConnections;
    totalOpenIncidents += incList.length;
    totalReviewRequiredStudents += reviewReq;

    return {
      examId: eid,
      title: String(row.title),
      subjectName:
        subj && typeof subj === "object" && "name" in subj
          ? String((subj as { name: unknown }).name)
          : "Mata Pelajaran",
      startsAt: row.starts_at ? String(row.starts_at) : null,
      endsAt: row.ends_at ? String(row.ends_at) : null,
      browserPolicy: (pol && typeof pol === "object" && "browser_policy" in pol
        ? String((pol as { browser_policy: unknown }).browser_policy)
        : "STANDARD_BROWSER_ALLOWED") as BrowserEnforcementPolicy,
      activeStudents,
      staleConnections,
      openIncidents: incList.length,
      submittedCount,
      totalAssigned: attList.length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    activeExamCount: exams.filter((e) => e.activeStudents > 0).length,
    totalActiveStudents,
    totalStaleConnections,
    totalOpenIncidents,
    totalReviewRequiredStudents,
    exams,
    recentAuditEvents: ((auditRows ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      action: String(a.action),
      actorRole: String(a.actor_role),
      summary: String(a.summary),
      createdAt: String(a.created_at),
    })),
  };
}
