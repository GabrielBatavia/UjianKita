import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import { hasPermission } from "@/policies/authorization";
import {
  normalizeLegacyTelemetryEventType,
  type AdminMonitoringOverviewData,
  type ExamControlCenterSummary,
  type ExamSecurityIncidentRecord,
  type ExamSecurityPolicyRecord,
  type ExamSecurityReportData,
  type HiddenVisibleDurationSpan,
  type IncidentReviewActionRecord,
  type MonitoredStudentRow,
  type MonitoringActivityTimelineEntry,
  type MonitoringAlertItem,
  type MonitoringSeverity,
  type StudentSecurityPolicyView,
} from "@/domain/monitoring/phase4-types";
import {
  classifyEventAndEvaluateIncident,
  getNeutralIncidentCopy,
  inferConnectionPresenceState,
  pairHiddenVisibleDurations,
  SECURITY_REPORT_DISCLAIMER_ID,
} from "@/domain/monitoring/presence-and-incidents";
import { assessExamBroClientHint } from "@/domain/monitoring/exambro-compat";
import {
  buildSebExamProfile,
  buildSebLaunchLinks,
  verifySebKeyProof,
} from "@/domain/monitoring/seb-verification";
import {
  batchedMonitoringEventsSchema,
  grantBrowserOverrideSchema,
  heartbeatRequestSchema,
  retentionCleanupSchema,
  sebVerifyRequestSchema,
  updateExamSecurityPolicySchema,
  updateIncidentStatusSchema,
} from "@/schemas/monitoring";
import { getActiveStudentContext } from "@/repositories/attempt-repository";
import { recordAuditEvent } from "@/repositories/audit-repository";
import {
  callHeartbeatRpc,
  callMonitoringEventsBatchRpc,
  checkActiveStudentBrowserOverride,
  checkAttemptHasVerifiedSeb,
  fetchActiveSebPlistXml,
  fetchAttemptPresenceContext,
  fetchAttemptTimelineEntries,
  fetchExamBasicMonitoringContext,
  fetchExamControlCenterRawData,
  fetchExamSecurityIncidents,
  fetchExamSecurityPolicy,
  fetchIncidentDetailWithActions,
  fetchSchoolMonitoringOverviewRaw,
  grantAttemptOverrideRpc,
  recordSebVerificationOutcome,
  transitionIncidentRpc,
  upsertDeduplicatedSecurityIncident,
  upsertExamSecurityPolicy,
} from "@/repositories/monitoring-repository";
import type { RequestAuditContext } from "@/services/admin-service";
import { ServiceError } from "@/services/errors";

async function assertStaffCanAccessExamMonitoring(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  requiredPermission:
    | "monitoring.read"
    | "monitoring.incidents.write"
    | "monitoring.policies.write"
    | "monitoring.reports.export" = "monitoring.read"
) {
  if (!actor.isActive || !hasPermission(actor.roles, requiredPermission)) {
    throw new ServiceError(403, "FORBIDDEN", "Akses pemantauan ujian ditolak.");
  }

  const examCtx = await fetchExamBasicMonitoringContext(supabase, examId);
  if (!examCtx || examCtx.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  }

  if (hasPermission(actor.roles, "monitoring.oversight")) {
    return examCtx;
  }

  const { data: canManage } = await supabase.rpc("auth_can_monitor_exam", {
    target_exam_id: examId,
  });

  if (canManage !== true && examCtx.createdBy !== actor.userId) {
    throw new ServiceError(
      403,
      "FORBIDDEN_EXAM_MONITORING",
      "Anda tidak ditugaskan untuk memantau ujian ini."
    );
  }

  return examCtx;
}

export async function getExamSecurityPolicyService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string
): Promise<ExamSecurityPolicyRecord> {
  const ctx = await assertStaffCanAccessExamMonitoring(supabase, actor, examId);
  return fetchExamSecurityPolicy(
    supabase,
    examId,
    ctx.schoolId,
    ctx.requireExamBrowser
  );
}

export async function updateExamSecurityPolicyService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  rawBody: unknown,
  origin: string,
  auditCtx: RequestAuditContext
): Promise<ExamSecurityPolicyRecord> {
  const ctx = await assertStaffCanAccessExamMonitoring(
    supabase,
    actor,
    examId,
    "monitoring.policies.write"
  );

  const parsed = updateExamSecurityPolicySchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_SECURITY_POLICY",
      parsed.error.issues[0]?.message ?? "Konfigurasi kebijakan keamanan tidak valid."
    );
  }

  const input = parsed.data;
  let sebConfigKeyHash = input.sebConfigKeyHash ?? null;
  let plistXmlToStore: string | null = null;

  if (input.generateSebProfileKey || (input.sebEnabled && !sebConfigKeyHash)) {
    const startUrl = `${origin}/student/exams/${examId}`;
    const built = buildSebExamProfile({ startUrl, examTitle: ctx.title });
    sebConfigKeyHash = built.configKeyHex;
    plistXmlToStore = built.plistXml;
  }

  const updated = await upsertExamSecurityPolicy(supabase, {
    examId,
    schoolId: ctx.schoolId,
    actorUserId: actor.userId,
    policy: {
      browserPolicy: input.browserPolicy,
      exambroEnabled: input.exambroEnabled,
      exambroMinAppHint: input.exambroMinAppHint ?? null,
      sebEnabled: input.sebEnabled,
      sebConfigKeyHash,
      sebBrowserExamKeyHash: input.sebBrowserExamKeyHash ?? null,
      sebAllowStandardWithOverride: input.sebAllowStandardWithOverride,
      copyPasteGuardEnabled: input.copyPasteGuardEnabled,
      contextMenuGuardEnabled: input.contextMenuGuardEnabled,
      watermarkEnabled: input.watermarkEnabled,
      watermarkOpacity: input.watermarkOpacity,
      heartbeatIntervalSeconds: input.heartbeatIntervalSeconds,
      staleThresholdSeconds: input.staleThresholdSeconds,
      visibilitySwitchWarnThreshold: input.visibilitySwitchWarnThreshold,
      visibilitySwitchReviewThreshold: input.visibilitySwitchReviewThreshold,
      hiddenDurationReviewSeconds: input.hiddenDurationReviewSeconds,
      reloadWarnThreshold: input.reloadWarnThreshold,
      reloadReviewThreshold: input.reloadReviewThreshold,
      copyPasteReviewThreshold: input.copyPasteReviewThreshold,
      privacyNoticeText: input.privacyNoticeText,
    },
    plistXmlToStore,
  });

  await recordAuditEvent(supabase, {
    schoolId: ctx.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.roles[0] ?? "teacher",
    action: "monitoring.policy_updated",
    entityType: "exam_security_policies",
    entityId: updated.id,
    summary: `Memperbarui kebijakan keamanan ujian ${ctx.title}`,
    metadata: {
      examId,
      browserPolicy: updated.browserPolicy,
      versionNumber: updated.versionNumber,
    },
    ...auditCtx,
  });

  return updated;
}

export async function getStudentSecurityPolicyViewService(
  studentSupabase: SupabaseClient,
  policyReaderSupabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  origin: string
): Promise<StudentSecurityPolicyView> {
  if (!actor.isActive || !hasPermission(actor.roles, "student.exams.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const studentCtx = await getActiveStudentContext(
    studentSupabase,
    actor.userId,
    actor.schoolId
  );
  if (!studentCtx) {
    throw new ServiceError(403, "STUDENT_NOT_ENROLLED", "Siswa belum terdaftar aktif.");
  }

  const examCtx = await fetchExamBasicMonitoringContext(policyReaderSupabase, examId);
  if (!examCtx || examCtx.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  }

  const policy = await fetchExamSecurityPolicy(
    policyReaderSupabase,
    examId,
    actor.schoolId,
    examCtx.requireExamBrowser
  );
  const override = await checkActiveStudentBrowserOverride(
    policyReaderSupabase,
    examId,
    studentCtx.studentId
  );

  const { data: activeAttempt } = await studentSupabase
    .from("exam_attempts")
    .select("id")
    .eq("exam_id", examId)
    .eq("student_id", studentCtx.studentId)
    .eq("status", "IN_PROGRESS")
    .maybeSingle();

  let sebVerifiedForAttempt = false;
  if (activeAttempt) {
    const check = await checkAttemptHasVerifiedSeb(
      policyReaderSupabase,
      String((activeAttempt as { id: string }).id)
    );
    sebVerifiedForAttempt = check.verified;
  }

  const links = buildSebLaunchLinks(origin, examId);

  return {
    examId,
    examTitle: examCtx.title,
    browserPolicy: policy.browserPolicy,
    exambroEnabled: policy.exambroEnabled,
    exambroMinAppHint: policy.exambroMinAppHint,
    sebEnabled: policy.sebEnabled,
    sebJsApiVerificationRequired:
      policy.browserPolicy === "VERIFIED_SEB_REQUIRED" &&
      Boolean(policy.sebConfigKeyHash || policy.sebBrowserExamKeyHash),
    sebVerifiedForAttempt,
    hasActiveStaffOverride: override.active,
    overrideReason: override.reason,
    copyPasteGuardEnabled: policy.copyPasteGuardEnabled,
    contextMenuGuardEnabled: policy.contextMenuGuardEnabled,
    watermarkEnabled: policy.watermarkEnabled,
    watermarkOpacity: policy.watermarkOpacity,
    heartbeatIntervalSeconds: policy.heartbeatIntervalSeconds,
    privacyNoticeText: policy.privacyNoticeText,
    sebConfigDownloadUrl: links.configDownloadUrl,
    sebLaunchUrl: links.launchUrl,
  };
}

export async function generateStudentSebConfigDownloadService(
  studentSupabase: SupabaseClient,
  policyReaderSupabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  origin: string
): Promise<{ filename: string; plistXml: string; configKeyHex: string }> {
  if (!actor.isActive || !hasPermission(actor.roles, "student.exams.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const examCtx = await fetchExamBasicMonitoringContext(policyReaderSupabase, examId);
  if (!examCtx || examCtx.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  }

  const { data: assigned } = await studentSupabase.rpc("auth_student_can_access_exam", {
    target_exam_id: examId,
  });
  if (assigned === false) {
    throw new ServiceError(403, "NO_CLASS_ASSIGNMENT", "Anda tidak terdaftar pada ujian ini.");
  }

  const stored = await fetchActiveSebPlistXml(policyReaderSupabase, examId);
  if (stored) {
    return {
      filename: `ujiankita-${examId.slice(0, 8)}.seb`,
      plistXml: stored.plistXml,
      configKeyHex: stored.configKeyHash,
    };
  }

  const built = buildSebExamProfile({
    startUrl: `${origin}/student/exams/${examId}`,
    examTitle: examCtx.title,
  });

  return {
    filename: `ujiankita-${examId.slice(0, 8)}.seb`,
    plistXml: built.plistXml,
    configKeyHex: built.configKeyHex,
  };
}

export async function verifyStudentSebProofService(
  studentSupabase: SupabaseClient,
  policyReaderSupabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  origin: string,
  headers: Headers,
  rawBody: unknown
) {
  if (!actor.isActive || !hasPermission(actor.roles, "student.attempts.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const studentCtx = await getActiveStudentContext(
    studentSupabase,
    actor.userId,
    actor.schoolId
  );
  if (!studentCtx) {
    throw new ServiceError(403, "STUDENT_NOT_ENROLLED", "Siswa belum terdaftar aktif.");
  }

  const parsed = sebVerifyRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_SEB_VERIFY_PAYLOAD",
      parsed.error.issues[0]?.message ?? "Payload verifikasi SEB tidak valid."
    );
  }

  const examCtx = await fetchExamBasicMonitoringContext(policyReaderSupabase, examId);
  if (!examCtx || examCtx.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "EXAM_NOT_FOUND", "Ujian tidak ditemukan.");
  }

  const policy = await fetchExamSecurityPolicy(
    policyReaderSupabase,
    examId,
    actor.schoolId,
    examCtx.requireExamBrowser
  );

  const outcome = verifySebKeyProof({
    requestUrl: parsed.data.pageUrl,
    expectedOrigin: origin,
    examId,
    expectedConfigKeyHex: policy.sebConfigKeyHash,
    expectedBrowserExamKeyHex: policy.sebBrowserExamKeyHash,
    submittedConfigKeyHash: parsed.data.configKeyHash,
    submittedBrowserExamKeyHash: parsed.data.browserExamKeyHash,
    headerConfigKeyHash: headers.get("x-safeexambrowser-configkeyhash"),
    headerRequestHash: headers.get("x-safeexambrowser-requesthash"),
  });

  await recordSebVerificationOutcome(policyReaderSupabase, {
    schoolId: actor.schoolId,
    examId,
    studentId: studentCtx.studentId,
    actorUserId: actor.userId,
    verified: outcome.verified,
    trustLevel: outcome.trustLevel,
    normalizedUrl: outcome.normalizedUrl,
    reason: outcome.reason,
  });

  return {
    verified: outcome.verified,
    trustLevel: outcome.trustLevel,
    matchedConfigKey: outcome.matchedConfigKey,
    matchedBrowserExamKey: outcome.matchedBrowserExamKey,
    reason: outcome.reason,
  };
}

export async function enforceBrowserPolicyOnExamAccess(params: {
  policyReaderSupabase: SupabaseClient;
  examId: string;
  schoolId: string;
  studentId: string;
  origin: string;
  headers: Headers;
  attemptIdIfExisting?: string | null;
  sebProof?: {
    pageUrl?: string;
    configKeyHash?: string;
    browserExamKeyHash?: string;
  } | null;
  browserPlatformHint?: "STANDARD_WEB" | "ANDROID_EXAMBRO" | "IOS_SAFE_EXAM_BROWSER" | "UNKNOWN";
  exambroHint?: boolean;
}) {
  const examCtx = await fetchExamBasicMonitoringContext(
    params.policyReaderSupabase,
    params.examId
  );
  const policy = await fetchExamSecurityPolicy(
    params.policyReaderSupabase,
    params.examId,
    params.schoolId,
    examCtx?.requireExamBrowser ?? false
  );

  if (policy.browserPolicy !== "VERIFIED_SEB_REQUIRED") {
    const hint = assessExamBroClientHint({
      userAgent: params.headers.get("user-agent"),
      declaredPlatform: params.browserPlatformHint,
      exambroDetectedHint: params.exambroHint,
    });
    return {
      allowed: true,
      policy,
      trustLevel: hint.trustLevel,
      browserPlatform: hint.platform,
    };
  }

  const override = await checkActiveStudentBrowserOverride(
    params.policyReaderSupabase,
    params.examId,
    params.studentId
  );
  if (override.active) {
    return {
      allowed: true,
      policy,
      trustLevel: "staff_override" as const,
      browserPlatform: "STANDARD_WEB" as const,
    };
  }

  if (params.attemptIdIfExisting) {
    const existingVerified = await checkAttemptHasVerifiedSeb(
      params.policyReaderSupabase,
      params.attemptIdIfExisting
    );
    if (existingVerified.verified) {
      return {
        allowed: true,
        policy,
        trustLevel: existingVerified.trustLevel,
        browserPlatform: "IOS_SAFE_EXAM_BROWSER" as const,
      };
    }
  }

  const headerConfig = params.headers.get("x-safeexambrowser-configkeyhash");
  const headerReq = params.headers.get("x-safeexambrowser-requesthash");
  if (headerConfig || headerReq || params.sebProof?.configKeyHash || params.sebProof?.browserExamKeyHash) {
    const verification = verifySebKeyProof({
      requestUrl:
        params.sebProof?.pageUrl ?? `${params.origin}/student/exams/${params.examId}`,
      expectedOrigin: params.origin,
      examId: params.examId,
      expectedConfigKeyHex: policy.sebConfigKeyHash,
      expectedBrowserExamKeyHex: policy.sebBrowserExamKeyHash,
      submittedConfigKeyHash: params.sebProof?.configKeyHash,
      submittedBrowserExamKeyHash: params.sebProof?.browserExamKeyHash,
      headerConfigKeyHash: headerConfig,
      headerRequestHash: headerReq,
    });

    if (verification.verified) {
      return {
        allowed: true,
        policy,
        trustLevel: verification.trustLevel,
        browserPlatform: "IOS_SAFE_EXAM_BROWSER" as const,
      };
    }
  }

  throw new ServiceError(
    403,
    "SEB_VERIFICATION_REQUIRED",
    "Ujian ini mewajibkan Safe Exam Browser (SEB) terverifikasi. Silakan buka tautan melalui aplikasi Safe Exam Browser atau hubungi pengawas untuk pengecualian darurat."
  );
}

export async function recordAttemptHeartbeatService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawBody: unknown,
  userAgent: string | null
) {
  if (!actor.isActive || !hasPermission(actor.roles, "student.attempts.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const parsed = heartbeatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_HEARTBEAT",
      parsed.error.issues[0]?.message ?? "Payload heartbeat tidak valid."
    );
  }

  const hint = assessExamBroClientHint({
    userAgent,
    declaredPlatform: parsed.data.browserPlatformHint,
    exambroDetectedHint: parsed.data.exambroHint,
  });

  try {
    return await callHeartbeatRpc(supabase, {
      attemptId,
      visible: parsed.data.visible,
      online: parsed.data.online,
      queuedAnswerCount: parsed.data.queuedAnswerCount,
      browserPlatformHint: hint.platform,
      exambroHint: hint.detectedViaHint,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ATTEMPT_NOT_FOUND") || msg.includes("FORBIDDEN")) {
      throw new ServiceError(404, "ATTEMPT_NOT_FOUND", "Sesi ujian tidak ditemukan.");
    }
    throw new ServiceError(500, "HEARTBEAT_ERROR", "Gagal memperbarui heartbeat sesi.");
  }
}

export async function recordMonitoringEventsBatchService(
  studentSupabase: SupabaseClient,
  policyReaderSupabase: SupabaseClient,
  actor: AuthenticatedActor,
  attemptId: string,
  rawBody: unknown
) {
  if (!actor.isActive || !hasPermission(actor.roles, "student.attempts.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus siswa aktif.");
  }

  const parsed = batchedMonitoringEventsSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_EVENT_BATCH",
      parsed.error.issues[0]?.message ?? "Payload batch aktivitas tidak valid."
    );
  }

  const normalized = parsed.data.events.map((ev) => ({
    clientEventId: ev.clientEventId,
    eventType: normalizeLegacyTelemetryEventType(ev.eventType),
    occurredAt: ev.occurredAt,
    metadata: ev.metadata,
  }));

  const rpcRes = await callMonitoringEventsBatchRpc(
    studentSupabase,
    attemptId,
    normalized
  );

  // Evaluate policy thresholds in non-blocking isolated try/catch
  if ((rpcRes.accepted ?? 0) > 0) {
    try {
      const presence = await fetchAttemptPresenceContext(
        policyReaderSupabase,
        attemptId
      );
      if (presence) {
        const examId = String(presence.exam_id);
        const schoolId = String(presence.school_id);
        const studentId = String(presence.student_id);
        const policy = await fetchExamSecurityPolicy(
          policyReaderSupabase,
          examId,
          schoolId
        );

        const counters = {
          visibilityHiddenCount: Number(presence.visibility_hidden_count ?? 0),
          reloadCount: Number(presence.reload_count ?? 0),
          connectionGapCount: Number(presence.connection_gap_count ?? 0),
          copyPasteCount: Number(presence.copy_paste_count ?? 0),
          contextMenuCount: Number(presence.context_menu_count ?? 0),
        };

        let highestSeverity: MonitoringSeverity =
          (presence.highest_severity as MonitoringSeverity) ?? "INFORMATIONAL";

        for (const ev of normalized) {
          const classified = classifyEventAndEvaluateIncident({
            eventType: ev.eventType,
            metadata: ev.metadata,
            countersAfterEvent: counters,
            policy,
          });
          if (classified.severity === "REVIEW_REQUIRED") {
            highestSeverity = "REVIEW_REQUIRED";
          } else if (
            classified.severity === "WARNING" &&
            highestSeverity === "INFORMATIONAL"
          ) {
            highestSeverity = "WARNING";
          }

          if (classified.incidentCandidate) {
            await upsertDeduplicatedSecurityIncident(policyReaderSupabase, {
              schoolId,
              examId,
              attemptId,
              studentId,
              reasonCode: classified.incidentCandidate.reasonCode,
              severity: classified.incidentCandidate.severity,
              title: classified.incidentCandidate.title,
              summary: classified.incidentCandidate.summary,
              observedAtIso: ev.occurredAt ?? new Date().toISOString(),
            });
          }
        }

        if (highestSeverity !== presence.highest_severity) {
          await policyReaderSupabase
            .from("attempt_monitoring_presence")
            .update({ highest_severity: highestSeverity })
            .eq("attempt_id", attemptId);
        }
      }
    } catch {
      // Monitoring incident synthesis must never disrupt telemetry acknowledgment
    }
  }

  return rpcRes;
}

export async function listTeacherMonitoredExamsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
) {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses pemantauan ujian ditolak.");
  }
  const overview = await fetchSchoolMonitoringOverviewRaw(supabase, actor.schoolId);
  return overview.exams;
}

export async function getTeacherExamControlCenterService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  filters?: {
    search?: string;
    presence?: string;
    severity?: string;
    attemptStatus?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{
  exam: {
    examId: string;
    title: string;
    subjectName: string;
    startsAt: string | null;
    endsAt: string | null;
    questionCount: number;
  };
  policy: ExamSecurityPolicyRecord;
  summary: ExamControlCenterSummary;
  alerts: MonitoringAlertItem[];
  students: MonitoredStudentRow[];
  totalFilteredStudents: number;
  page: number;
  pageSize: number;
  incidents: ExamSecurityIncidentRecord[];
  generatedAt: string;
}> {
  const ctx = await assertStaffCanAccessExamMonitoring(supabase, actor, examId);
  const policy = await fetchExamSecurityPolicy(
    supabase,
    examId,
    ctx.schoolId,
    ctx.requireExamBrowser
  );
  const raw = await fetchExamControlCenterRawData(supabase, examId);
  const now = new Date();

  const attemptByStudent = new Map(raw.attempts.map((a) => [a.studentId, a]));
  const openIncidentCountByStudent = new Map<string, number>();
  for (const inc of raw.incidents) {
    if (
      inc.status === "NEW" ||
      inc.status === "UNDER_REVIEW" ||
      inc.status === "ACKNOWLEDGED"
    ) {
      openIncidentCountByStudent.set(
        inc.studentId,
        (openIncidentCountByStudent.get(inc.studentId) ?? 0) + 1
      );
    }
  }

  const allRows: MonitoredStudentRow[] = raw.assignments.map((student) => {
    const att = attemptByStudent.get(student.studentId);
    const presence = att ? raw.presenceByAttempt[att.id] : undefined;
    const status = att?.status ?? "NOT_STARTED";
    const lastHeartbeatAt = presence?.last_heartbeat_at_utc
      ? String(presence.last_heartbeat_at_utc)
      : null;

    const { state: inferredState, secondsSinceLastHeartbeat } =
      inferConnectionPresenceState({
        attemptStatus: status,
        lastHeartbeatAt,
        now,
        staleThresholdSeconds: policy.staleThresholdSeconds,
      });

    // If connection went stale while in progress and hasn't created a gap incident yet, classify cleanly in memory
    const answeredCount = att ? (raw.answeredCountByAttempt[att.id] ?? 0) : 0;
    const totalQ = Math.max(ctx.questionCount, 1);

    let highestSeverity = (presence?.highest_severity ??
      "INFORMATIONAL") as MonitoringSeverity;
    if (inferredState === "STALE" && highestSeverity === "INFORMATIONAL") {
      highestSeverity = "WARNING";
    }

    return {
      attemptId: att?.id ?? null,
      studentId: student.studentId,
      studentName: student.studentName,
      studentNis: student.studentNis,
      classId: student.classId,
      className: student.className,
      attemptStatus: status,
      presenceState: inferredState,
      lastHeartbeatAt,
      secondsSinceLastHeartbeat,
      startedAt: att?.startedAtUtc ?? null,
      effectiveDeadlineAt: att?.deadlineAtUtc ?? null,
      submittedAt: att?.submittedAtUtc ?? null,
      answeredCount,
      totalQuestions: ctx.questionCount,
      progressPercent: att ? Math.min(100, Math.round((answeredCount / totalQ) * 100)) : 0,
      browserPlatform: att?.browserPlatform ?? "UNKNOWN",
      browserTrustLevel: att?.browserTrustLevel ?? "standard_browser",
      visibilityHiddenCount: Number(presence?.visibility_hidden_count ?? 0),
      reloadCount: Number(presence?.reload_count ?? 0),
      connectionGapCount: Number(presence?.connection_gap_count ?? 0),
      copyPasteCount: Number(presence?.copy_paste_count ?? 0),
      contextMenuCount: Number(presence?.context_menu_count ?? 0),
      highestSeverity,
      openIncidentCount: openIncidentCountByStudent.get(student.studentId) ?? 0,
      hasManualOverride:
        Boolean(raw.overridesByStudent[student.studentId]) ||
        att?.browserTrustLevel === "staff_override",
    };
  });

  // Trigger stale disconnect observation once per transition when stale threshold crossed
  const staleToReport = allRows.filter(
    (r) =>
      r.attemptId &&
      r.attemptStatus === "IN_PROGRESS" &&
      r.presenceState === "STALE" &&
      !raw.presenceByAttempt[r.attemptId]?.stale_notified_at_utc
  );
  if (staleToReport.length > 0) {
    const staleCopy = getNeutralIncidentCopy("PROLONGED_DISCONNECTION");
    await Promise.allSettled(
      staleToReport.slice(0, 20).map(async (r) => {
        if (!r.attemptId) return;
        await supabase
          .from("attempt_monitoring_presence")
          .update({
            presence_state: "STALE",
            connection_gap_count: r.connectionGapCount + 1,
            stale_notified_at_utc: now.toISOString(),
          })
          .eq("attempt_id", r.attemptId);

        await supabase.from("attempt_events").insert({
          school_id: ctx.schoolId,
          attempt_id: r.attemptId,
          event_source: "server_inferred",
          event_type: "CONNECTION_GAP_OBSERVED",
          severity: "WARNING",
          occurred_at_utc: now.toISOString(),
          metadata: {
            secondsSinceLastHeartbeat: r.secondsSinceLastHeartbeat,
          },
        });

        await upsertDeduplicatedSecurityIncident(supabase, {
          schoolId: ctx.schoolId,
          examId,
          attemptId: r.attemptId,
          studentId: r.studentId,
          reasonCode: "PROLONGED_DISCONNECTION",
          severity: "WARNING",
          title: staleCopy.title,
          summary: `${staleCopy.summary} (Terakhir aktif ${r.secondsSinceLastHeartbeat ?? policy.staleThresholdSeconds} detik lalu).`,
          observedAtIso: now.toISOString(),
        });
      })
    );
  }

  const summary: ExamControlCenterSummary = {
    totalAssigned: allRows.length,
    notStartedCount: allRows.filter((r) => r.attemptStatus === "NOT_STARTED").length,
    inProgressCount: allRows.filter((r) => r.attemptStatus === "IN_PROGRESS").length,
    submittedCount: allRows.filter((r) => r.attemptStatus === "SUBMITTED").length,
    expiredCount: allRows.filter((r) => r.attemptStatus === "EXPIRED").length,
    recentlySeenCount: allRows.filter((r) => r.presenceState === "RECENTLY_SEEN").length,
    staleCount: allRows.filter((r) => r.presenceState === "STALE").length,
    unknownPresenceCount: allRows.filter((r) => r.presenceState === "UNKNOWN").length,
    reviewRequiredCount: allRows.filter((r) => r.highestSeverity === "REVIEW_REQUIRED")
      .length,
    openIncidentCount: raw.incidents.filter(
      (i) => i.status === "NEW" || i.status === "UNDER_REVIEW" || i.status === "ACKNOWLEDGED"
    ).length,
    sebVerifiedCount: allRows.filter(
      (r) =>
        r.browserTrustLevel === "verified_seb_header_and_key" ||
        r.browserTrustLevel === "verified_seb_js_key"
    ).length,
    exambroHintCount: allRows.filter((r) => r.browserPlatform === "ANDROID_EXAMBRO").length,
  };

  let filtered = allRows;
  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.studentName.toLowerCase().includes(q) ||
        (r.studentNis ?? "").toLowerCase().includes(q) ||
        (r.className ?? "").toLowerCase().includes(q)
    );
  }
  if (filters?.presence && filters.presence !== "ALL") {
    filtered = filtered.filter((r) => r.presenceState === filters.presence);
  }
  if (filters?.severity && filters.severity !== "ALL") {
    filtered = filtered.filter((r) => r.highestSeverity === filters.severity);
  }
  if (filters?.attemptStatus && filters.attemptStatus !== "ALL") {
    filtered = filtered.filter((r) => r.attemptStatus === filters.attemptStatus);
  }

  // Sort REVIEW_REQUIRED & STALE to the top so proctors spot attention items cleanly
  const severityWeight: Record<MonitoringSeverity, number> = {
    REVIEW_REQUIRED: 3,
    WARNING: 2,
    INFORMATIONAL: 1,
  };
  filtered.sort((a, b) => {
    const sevDiff = severityWeight[b.highestSeverity] - severityWeight[a.highestSeverity];
    if (sevDiff !== 0) return sevDiff;
    if (a.presenceState === "STALE" && b.presenceState !== "STALE") return -1;
    if (b.presenceState === "STALE" && a.presenceState !== "STALE") return 1;
    return a.studentName.localeCompare(b.studentName, "id-ID");
  });

  const page = Math.max(1, filters?.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters?.pageSize ?? 50));
  const pagedStudents = filtered.slice((page - 1) * pageSize, page * pageSize);

  const alerts: MonitoringAlertItem[] = raw.incidents
    .filter((i) => i.status === "NEW" || i.status === "UNDER_REVIEW")
    .slice(0, 15)
    .map((i) => ({
      incidentId: i.id,
      attemptId: i.attemptId,
      studentId: i.studentId,
      studentName: i.studentName,
      className: i.className,
      reasonCode: i.reasonCode,
      status: i.status,
      severity: i.severity,
      title: i.title,
      summary: i.summary,
      occurrenceCount: i.occurrenceCount,
      lastObservedAt: i.lastObservedAt,
    }));

  return {
    exam: {
      examId: ctx.examId,
      title: ctx.title,
      subjectName: ctx.subjectName,
      startsAt: ctx.startsAt,
      endsAt: ctx.endsAt,
      questionCount: ctx.questionCount,
    },
    policy,
    summary,
    alerts,
    students: pagedStudents,
    totalFilteredStudents: filtered.length,
    page,
    pageSize,
    incidents: raw.incidents,
    generatedAt: now.toISOString(),
  };
}

export async function getStudentMonitoringTimelineService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  attemptId: string
): Promise<{
  student: MonitoredStudentRow;
  timeline: MonitoringActivityTimelineEntry[];
  hiddenDurations: HiddenVisibleDurationSpan[];
  incidents: ExamSecurityIncidentRecord[];
  disclaimer: string;
}> {
  const controlCenter = await getTeacherExamControlCenterService(
    supabase,
    actor,
    examId,
    { page: 1, pageSize: 500 }
  );
  const studentRow = controlCenter.students.find((s) => s.attemptId === attemptId);
  if (!studentRow) {
    throw new ServiceError(
      404,
      "ATTEMPT_NOT_FOUND",
      "Sesi siswa pada ujian ini tidak ditemukan."
    );
  }

  const timeline = await fetchAttemptTimelineEntries(supabase, attemptId);
  const hiddenDurations = pairHiddenVisibleDurations(timeline);
  const incidents = controlCenter.incidents.filter(
    (i) => i.attemptId === attemptId || i.studentId === studentRow.studentId
  );

  return {
    student: studentRow,
    timeline,
    hiddenDurations,
    incidents,
    disclaimer: SECURITY_REPORT_DISCLAIMER_ID,
  };
}

export async function listExamIncidentsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string
): Promise<ExamSecurityIncidentRecord[]> {
  await assertStaffCanAccessExamMonitoring(supabase, actor, examId);
  return fetchExamSecurityIncidents(supabase, examId);
}

export async function getIncidentDetailService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  incidentId: string
): Promise<{
  incident: ExamSecurityIncidentRecord;
  actions: IncidentReviewActionRecord[];
}> {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.read")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses tinjauan insiden ditolak.");
  }

  const detail = await fetchIncidentDetailWithActions(supabase, incidentId);
  if (!detail || detail.incident.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "INCIDENT_NOT_FOUND", "Insiden tidak ditemukan.");
  }

  await assertStaffCanAccessExamMonitoring(supabase, actor, detail.incident.examId);
  return detail;
}

export async function transitionIncidentStatusService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  incidentId: string,
  rawBody: unknown,
  auditCtx: RequestAuditContext
) {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.incidents.write")) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin meninjau insiden.");
  }

  const parsed = updateIncidentStatusSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_INCIDENT_UPDATE",
      parsed.error.issues[0]?.message ?? "Data pembaruan insiden tidak valid."
    );
  }

  const detail = await fetchIncidentDetailWithActions(supabase, incidentId);
  if (!detail || detail.incident.schoolId !== actor.schoolId) {
    throw new ServiceError(404, "INCIDENT_NOT_FOUND", "Insiden tidak ditemukan.");
  }

  await assertStaffCanAccessExamMonitoring(
    supabase,
    actor,
    detail.incident.examId,
    "monitoring.incidents.write"
  );

  const result = await transitionIncidentRpc(
    supabase,
    incidentId,
    parsed.data.status,
    parsed.data.note
  );

  await recordAuditEvent(supabase, {
    schoolId: detail.incident.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.roles[0] ?? "teacher",
    action: "monitoring.incident_status_changed",
    entityType: "exam_security_incidents",
    entityId: incidentId,
    summary: `Mengubah status insiden ${detail.incident.title} menjadi ${parsed.data.status}`,
    metadata: {
      examId: detail.incident.examId,
      previousStatus: detail.incident.status,
      newStatus: parsed.data.status,
    },
    ...auditCtx,
  });

  return result;
}

export async function grantBrowserOverrideService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  target: { attemptId?: string; examId: string; studentId?: string },
  rawBody: unknown,
  auditCtx: RequestAuditContext
) {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.incidents.write")) {
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin memberikan pengecualian peramban."
    );
  }

  const ctx = await assertStaffCanAccessExamMonitoring(
    supabase,
    actor,
    target.examId,
    "monitoring.incidents.write"
  );

  const parsed = grantBrowserOverrideSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_OVERRIDE_PAYLOAD",
      parsed.error.issues[0]?.message ?? "Payload pengecualian peramban tidak valid."
    );
  }

  const res = await grantAttemptOverrideRpc(
    supabase,
    target,
    parsed.data.reason,
    parsed.data.durationMinutes
  );

  await recordAuditEvent(supabase, {
    schoolId: ctx.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.roles[0] ?? "teacher",
    action: "monitoring.browser_override_granted",
    entityType: target.attemptId ? "exam_attempts" : "exam_student_browser_overrides",
    entityId: target.attemptId ?? target.studentId ?? target.examId,
    summary: `Memberikan pengecualian darurat kebijakan peramban pada ujian ${ctx.title}`,
    metadata: {
      examId: target.examId,
      attemptId: target.attemptId ?? null,
      studentId: target.studentId ?? null,
      durationMinutes: parsed.data.durationMinutes,
    },
    ...auditCtx,
  });

  return res;
}

export async function buildExamSecurityReportService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  examId: string,
  auditCtx?: RequestAuditContext
): Promise<ExamSecurityReportData> {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.reports.export")) {
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki izin mengekspor laporan keamanan."
    );
  }

  const control = await getTeacherExamControlCenterService(supabase, actor, examId, {
    page: 1,
    pageSize: 500,
  });

  if (auditCtx) {
    await recordAuditEvent(supabase, {
      schoolId: control.policy.schoolId,
      actorUserId: actor.userId,
      actorRole: actor.roles[0] ?? "teacher",
      action: "monitoring.report_exported",
      entityType: "exams",
      entityId: examId,
      summary: `Mengekspor laporan pemantauan keamanan ujian ${control.exam.title}`,
      metadata: {
        studentCount: control.students.length,
        incidentCount: control.incidents.length,
      },
      ...auditCtx,
    });
  }

  return {
    generatedAt: control.generatedAt,
    examId: control.exam.examId,
    examTitle: control.exam.title,
    subjectName: control.exam.subjectName,
    browserPolicy: control.policy.browserPolicy,
    disclaimer: SECURITY_REPORT_DISCLAIMER_ID,
    summary: control.summary,
    students: control.students,
    incidents: control.incidents,
  };
}

export async function getAdminMonitoringOverviewService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<AdminMonitoringOverviewData> {
  if (!actor.isActive || !hasPermission(actor.roles, "monitoring.oversight")) {
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Akses pusat pemantauan sekolah hanya untuk administrator."
    );
  }
  return fetchSchoolMonitoringOverviewRaw(supabase, actor.schoolId);
}

export async function runMonitoringRetentionPurgeService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawBody: unknown,
  auditCtx: RequestAuditContext
) {
  if (!actor.isActive || !actor.roles.includes("admin")) {
    throw new ServiceError(
      403,
      "FORBIDDEN",
      "Pembersihan data retensi hanya diizinkan untuk administrator sekolah."
    );
  }

  const parsed = retentionCleanupSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "INVALID_RETENTION_PAYLOAD",
      parsed.error.issues[0]?.message ?? "Parameter retensi tidak valid."
    );
  }

  const { data, error } = await supabase.rpc(
    "purge_expired_monitoring_records_atomic",
    {
      p_school_id: actor.schoolId,
      p_days_to_keep: parsed.data.daysToKeep,
      p_dry_run: parsed.data.dryRun,
    }
  );
  if (error) {
    throw new ServiceError(
      500,
      "RETENTION_PURGE_ERROR",
      "Gagal menjalankan kebijakan retensi log pemantauan."
    );
  }

  if (!parsed.data.dryRun) {
    await recordAuditEvent(supabase, {
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      actorRole: "admin",
      action: "monitoring.retention_purged",
      entityType: "monitoring_retention",
      summary: `Menjalankan retensi log pemantauan (> ${parsed.data.daysToKeep} hari)`,
      metadata: {
        daysToKeep: parsed.data.daysToKeep,
        result: data,
      },
      ...auditCtx,
    });
  }

  return data;
}
