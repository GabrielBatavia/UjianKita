/**
 * Phase 4 Security, Browser Integration & Real-Time Monitoring Domain Contracts.
 *
 * Design principles:
 * 1. Honest evidence model: distinguish SERVER_CONFIRMED, CLIENT_REPORTED, and
 *    SERVER_INFERRED observations; distinguish cryptographic SEB verification
 *    from unverified Android ExamBro/client hints.
 * 2. Neutral terminology: use non-accusatory observations and review flags.
 *    Monitoring systems NEVER automatically fail a student or alter scores.
 * 3. Decoupled telemetry: monitoring pipelines never block answer saves or
 *    final exam submissions.
 */

import type { AttemptLifecycleStatus } from "@/domain/exams/contracts";

export type BrowserEnforcementPolicy =
  | "STANDARD_BROWSER_ALLOWED"
  | "SECURE_BROWSER_RECOMMENDED"
  | "VERIFIED_SEB_REQUIRED";

export type MonitoringEventSource =
  | "SERVER_CONFIRMED"
  | "CLIENT_REPORTED"
  | "SERVER_INFERRED";

export type MonitoringSeverity =
  | "INFORMATIONAL"
  | "WARNING"
  | "REVIEW_REQUIRED";

export type ConnectionPresenceState =
  | "RECENTLY_SEEN"
  | "STALE"
  | "UNKNOWN"
  | "ENDED";

export type MonitoringBrowserPlatform =
  | "STANDARD_WEB"
  | "ANDROID_EXAMBRO"
  | "IOS_SAFE_EXAM_BROWSER"
  | "UNKNOWN";

export type MonitoringTrustLevel =
  | "verified_seb_header_and_key"
  | "verified_seb_js_key"
  | "unverified_client_hint"
  | "standard_browser"
  | "staff_override";

export type MonitoringEventType =
  | "EXAM_SESSION_STARTED"
  | "EXAM_SESSION_RESUMED"
  | "EXAM_SESSION_SUBMITTED"
  | "EXAM_SESSION_EXPIRED"
  | "EXAM_PAGE_VISIBLE"
  | "EXAM_PAGE_HIDDEN"
  | "EXAM_PAGE_RELOADED"
  | "EXAM_PAGE_NAVIGATION_OBSERVED"
  | "CONNECTION_GAP_OBSERVED"
  | "CONNECTION_RESTORED"
  | "COPY_EVENT_OBSERVED"
  | "PASTE_EVENT_OBSERVED"
  | "CONTEXT_MENU_EVENT_OBSERVED"
  | "EXAMBRO_HINT_REPORTED"
  | "SEB_VERIFICATION_SUCCEEDED"
  | "SEB_VERIFICATION_FAILED"
  | "BROWSER_POLICY_OVERRIDE_GRANTED";

export type LegacyTelemetryEventType =
  | "PAGE_HIDDEN"
  | "PAGE_VISIBLE"
  | "RELOAD_RECOVERY"
  | "CONNECTION_LOST"
  | "CONNECTION_RESTORED"
  | "STORAGE_WARNING"
  | "COPY_PASTE_ATTEMPT"
  | "EXIT_ATTEMPT";

export type IncidentStatus =
  | "NEW"
  | "UNDER_REVIEW"
  | "ACKNOWLEDGED"
  | "RESOLVED"
  | "DISMISSED";

export type IncidentReasonCode =
  | "PROLONGED_ABSENCE"
  | "REPEATED_VISIBILITY_SWITCHES"
  | "REPEATED_RELOADS"
  | "COPY_PASTE_BURST"
  | "PROLONGED_DISCONNECTION"
  | "BROWSER_POLICY_MISMATCH"
  | "MANUAL_STAFF_FLAG";

export interface ExamSecurityPolicyRecord {
  id: string;
  schoolId: string;
  examId: string;
  versionNumber: number;
  browserPolicy: BrowserEnforcementPolicy;
  exambroEnabled: boolean;
  exambroMinAppHint: string | null;
  sebEnabled: boolean;
  sebConfigKeyHash: string | null;
  sebBrowserExamKeyHash: string | null;
  sebAllowStandardWithOverride: boolean;
  copyPasteGuardEnabled: boolean;
  contextMenuGuardEnabled: boolean;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
  heartbeatIntervalSeconds: number;
  staleThresholdSeconds: number;
  visibilitySwitchWarnThreshold: number;
  visibilitySwitchReviewThreshold: number;
  hiddenDurationReviewSeconds: number;
  reloadWarnThreshold: number;
  reloadReviewThreshold: number;
  copyPasteReviewThreshold: number;
  privacyNoticeText: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface StudentSecurityPolicyView {
  examId: string;
  examTitle: string;
  browserPolicy: BrowserEnforcementPolicy;
  exambroEnabled: boolean;
  exambroMinAppHint: string | null;
  sebEnabled: boolean;
  sebJsApiVerificationRequired: boolean;
  sebVerifiedForAttempt: boolean;
  hasActiveStaffOverride: boolean;
  overrideReason: string | null;
  copyPasteGuardEnabled: boolean;
  contextMenuGuardEnabled: boolean;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
  heartbeatIntervalSeconds: number;
  privacyNoticeText: string;
  sebConfigDownloadUrl: string;
  sebLaunchUrl: string;
}

export interface ExamControlCenterSummary {
  totalAssigned: number;
  notStartedCount: number;
  inProgressCount: number;
  submittedCount: number;
  expiredCount: number;
  recentlySeenCount: number;
  staleCount: number;
  unknownPresenceCount: number;
  reviewRequiredCount: number;
  openIncidentCount: number;
  sebVerifiedCount: number;
  exambroHintCount: number;
}

export interface MonitoredStudentRow {
  attemptId: string | null;
  studentId: string;
  studentName: string;
  studentNis: string | null;
  classId: string | null;
  className: string | null;
  attemptStatus: AttemptLifecycleStatus;
  presenceState: ConnectionPresenceState;
  lastHeartbeatAt: string | null;
  secondsSinceLastHeartbeat: number | null;
  startedAt: string | null;
  effectiveDeadlineAt: string | null;
  submittedAt: string | null;
  answeredCount: number;
  totalQuestions: number;
  progressPercent: number;
  browserPlatform: MonitoringBrowserPlatform;
  browserTrustLevel: MonitoringTrustLevel;
  visibilityHiddenCount: number;
  reloadCount: number;
  connectionGapCount: number;
  copyPasteCount: number;
  contextMenuCount: number;
  highestSeverity: MonitoringSeverity;
  openIncidentCount: number;
  hasManualOverride: boolean;
}

export interface MonitoringAlertItem {
  incidentId: string;
  attemptId: string | null;
  studentId: string;
  studentName: string;
  className: string | null;
  reasonCode: IncidentReasonCode;
  status: IncidentStatus;
  severity: MonitoringSeverity;
  title: string;
  summary: string;
  occurrenceCount: number;
  lastObservedAt: string;
}

export interface MonitoringActivityTimelineEntry {
  id: string;
  eventType: MonitoringEventType;
  source: MonitoringEventSource;
  severity: MonitoringSeverity;
  occurredAt: string;
  recordedAt: string;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
}

export interface HiddenVisibleDurationSpan {
  hiddenAt: string;
  visibleAt: string | null;
  durationSeconds: number | null;
  source: MonitoringEventSource;
}

export interface ExamSecurityIncidentRecord {
  id: string;
  schoolId: string;
  examId: string;
  attemptId: string | null;
  studentId: string;
  studentName: string;
  studentNis: string | null;
  className: string | null;
  reasonCode: IncidentReasonCode;
  status: IncidentStatus;
  severity: MonitoringSeverity;
  title: string;
  summary: string;
  occurrenceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  resolutionSummary: string | null;
  updatedAt: string;
}

export interface IncidentReviewActionRecord {
  id: string;
  incidentId: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  previousStatus: IncidentStatus | null;
  newStatus: IncidentStatus;
  note: string;
  createdAt: string;
}

export interface ExamSecurityReportData {
  generatedAt: string;
  examId: string;
  examTitle: string;
  subjectName: string;
  browserPolicy: BrowserEnforcementPolicy;
  disclaimer: string;
  summary: ExamControlCenterSummary;
  students: MonitoredStudentRow[];
  incidents: ExamSecurityIncidentRecord[];
}

export interface AdminMonitoringOverviewData {
  generatedAt: string;
  activeExamCount: number;
  totalActiveStudents: number;
  totalStaleConnections: number;
  totalOpenIncidents: number;
  totalReviewRequiredStudents: number;
  exams: Array<{
    examId: string;
    title: string;
    subjectName: string;
    startsAt: string | null;
    endsAt: string | null;
    browserPolicy: BrowserEnforcementPolicy;
    activeStudents: number;
    staleConnections: number;
    openIncidents: number;
    submittedCount: number;
    totalAssigned: number;
  }>;
  recentAuditEvents: Array<{
    id: string;
    action: string;
    actorRole: string;
    summary: string;
    createdAt: string;
  }>;
}

export const DEFAULT_PRIVACY_NOTICE_ID =
  "Selama ujian berlangsung, UjianKita mencatat sinyal teknis konektivitas (heartbeat), perubahan fokus atau muat ulang tab, serta informasi mode peramban demi keandalan layanan dan integritas evaluasi. Sistem tidak merekam kamera, mikrofon, atau isi clipboard di luar halaman ujian, dan catatan pemantauan tidak pernah mengubah nilai maupun menggugurkan ujian secara otomatis.";

export function normalizeLegacyTelemetryEventType(
  eventType: MonitoringEventType | LegacyTelemetryEventType
): MonitoringEventType {
  switch (eventType) {
    case "PAGE_HIDDEN":
      return "EXAM_PAGE_HIDDEN";
    case "PAGE_VISIBLE":
      return "EXAM_PAGE_VISIBLE";
    case "RELOAD_RECOVERY":
      return "EXAM_PAGE_RELOADED";
    case "CONNECTION_LOST":
      return "CONNECTION_GAP_OBSERVED";
    case "CONNECTION_RESTORED":
      return "CONNECTION_RESTORED";
    case "COPY_PASTE_ATTEMPT":
      return "COPY_EVENT_OBSERVED";
    case "EXIT_ATTEMPT":
      return "EXAM_PAGE_NAVIGATION_OBSERVED";
    case "STORAGE_WARNING":
      return "CONNECTION_GAP_OBSERVED";
    default:
      return eventType;
  }
}

export function createDefaultSecurityPolicy(params: {
  examId: string;
  schoolId: string;
  requireExamBrowser?: boolean;
}): ExamSecurityPolicyRecord {
  return {
    id: `default-${params.examId}`,
    schoolId: params.schoolId,
    examId: params.examId,
    versionNumber: 1,
    browserPolicy: params.requireExamBrowser
      ? "SECURE_BROWSER_RECOMMENDED"
      : "STANDARD_BROWSER_ALLOWED",
    exambroEnabled: Boolean(params.requireExamBrowser),
    exambroMinAppHint: null,
    sebEnabled: Boolean(params.requireExamBrowser),
    sebConfigKeyHash: null,
    sebBrowserExamKeyHash: null,
    sebAllowStandardWithOverride: true,
    copyPasteGuardEnabled: true,
    contextMenuGuardEnabled: true,
    watermarkEnabled: true,
    watermarkOpacity: 0.08,
    heartbeatIntervalSeconds: 30,
    staleThresholdSeconds: 90,
    visibilitySwitchWarnThreshold: 3,
    visibilitySwitchReviewThreshold: 6,
    hiddenDurationReviewSeconds: 60,
    reloadWarnThreshold: 3,
    reloadReviewThreshold: 5,
    copyPasteReviewThreshold: 3,
    privacyNoticeText: DEFAULT_PRIVACY_NOTICE_ID,
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  };
}
