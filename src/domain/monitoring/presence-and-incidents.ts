/**
 * Pure Domain Logic for Connection Presence Inference, Severity Classification,
 * Neutral Alert/Incident Synthesis, Duration Pairing & Safe CSV Reports.
 */

import type { AttemptLifecycleStatus } from "@/domain/exams/contracts";
import type {
  ConnectionPresenceState,
  ExamSecurityPolicyRecord,
  ExamSecurityReportData,
  HiddenVisibleDurationSpan,
  IncidentReasonCode,
  MonitoringActivityTimelineEntry,
  MonitoringEventSource,
  MonitoringEventType,
  MonitoringSeverity,
} from "@/domain/monitoring/phase4-types";

export function inferConnectionPresenceState(params: {
  attemptStatus: AttemptLifecycleStatus;
  lastHeartbeatAt: string | null;
  now?: Date;
  staleThresholdSeconds?: number;
}): { state: ConnectionPresenceState; secondsSinceLastHeartbeat: number | null } {
  if (
    params.attemptStatus === "SUBMITTED" ||
    params.attemptStatus === "EXPIRED" ||
    params.attemptStatus === "CANCELLED_BY_ADMIN"
  ) {
    return { state: "ENDED", secondsSinceLastHeartbeat: null };
  }

  if (!params.lastHeartbeatAt) {
    return { state: "UNKNOWN", secondsSinceLastHeartbeat: null };
  }

  const lastMs = new Date(params.lastHeartbeatAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return { state: "UNKNOWN", secondsSinceLastHeartbeat: null };
  }

  const nowMs = (params.now ?? new Date()).getTime();
  const deltaSeconds = Math.max(0, Math.floor((nowMs - lastMs) / 1000));
  const threshold = params.staleThresholdSeconds ?? 90;

  return {
    state: deltaSeconds <= threshold ? "RECENTLY_SEEN" : "STALE",
    secondsSinceLastHeartbeat: deltaSeconds,
  };
}

export function enforceAuthoritativeEventSource(
  eventType: MonitoringEventType
): MonitoringEventSource {
  switch (eventType) {
    case "EXAM_SESSION_STARTED":
    case "EXAM_SESSION_RESUMED":
    case "EXAM_SESSION_SUBMITTED":
    case "EXAM_SESSION_EXPIRED":
    case "SEB_VERIFICATION_SUCCEEDED":
    case "SEB_VERIFICATION_FAILED":
    case "BROWSER_POLICY_OVERRIDE_GRANTED":
      return "SERVER_CONFIRMED";
    case "CONNECTION_GAP_OBSERVED":
      return "SERVER_INFERRED";
    default:
      return "CLIENT_REPORTED";
  }
}

export interface MonitoringCounters {
  visibilityHiddenCount: number;
  reloadCount: number;
  connectionGapCount: number;
  copyPasteCount: number;
  contextMenuCount: number;
}

export interface ClassifiedMonitoringOutcome {
  severity: MonitoringSeverity;
  incidentCandidate: {
    reasonCode: IncidentReasonCode;
    severity: MonitoringSeverity;
    title: string;
    summary: string;
  } | null;
}

const NEUTRAL_INCIDENT_COPY: Readonly<
  Record<IncidentReasonCode, { title: string; summary: string }>
> = {
  PROLONGED_ABSENCE: {
    title: "Halaman Ujian Tidak Aktif Cukup Lama",
    summary:
      "Tab atau jendela ujian dilaporkan berada di latar belakang melebihi ambang durasi pengawasan. Perlu verifikasi wajar kondisi perangkat atau jaringan siswa.",
  },
  REPEATED_VISIBILITY_SWITCHES: {
    title: "Perpindahan Fokus Halaman Berulang",
    summary:
      "Tercatat beberapa kali perpindahan visibilitas halaman ujian oleh sisi klien. Sinyal ini bersifat indikatif dan memerlukan tinjauan manusia.",
  },
  REPEATED_RELOADS: {
    title: "Muat Ulang Halaman Ujian Berulang",
    summary:
      "Halaman ujian mengalami pemulihan atau muat ulang berulang kali selama sesi berlangsung.",
  },
  COPY_PASTE_BURST: {
    title: "Aktivitas Salin/Tempel Terdeteksi Berulang",
    summary:
      "Terjadi beberapa percobaan salin atau tempel pada area soal selama sesi ujian.",
  },
  PROLONGED_DISCONNECTION: {
    title: "Kesenjangan Sinyal Koneksi Teramati",
    summary:
      "Heartbeat perangkat siswa melewati batas waktu kedaluwarsa koneksi. Kondisi dapat disebabkan jaringan sekolah, perangkat, atau penutupan aplikasi.",
  },
  BROWSER_POLICY_MISMATCH: {
    title: "Akses Peramban Tidak Sesuai Kebijakan Ujian",
    summary:
      "Permintaan akses ujian tidak membawa bukti kunci peramban aman yang dipersyaratkan pada kebijakan ujian.",
  },
  MANUAL_STAFF_FLAG: {
    title: "Catatan Tinjauan Pengawas",
    summary:
      "Insiden dibuat atau ditandai secara manual oleh guru atau pengawas ujian.",
  },
};

export function getNeutralIncidentCopy(reasonCode: IncidentReasonCode): {
  title: string;
  summary: string;
} {
  return NEUTRAL_INCIDENT_COPY[reasonCode];
}

export function classifyEventAndEvaluateIncident(params: {
  eventType: MonitoringEventType;
  metadata?: Record<string, unknown>;
  countersAfterEvent: MonitoringCounters;
  policy: Pick<
    ExamSecurityPolicyRecord,
    | "visibilitySwitchWarnThreshold"
    | "visibilitySwitchReviewThreshold"
    | "hiddenDurationReviewSeconds"
    | "reloadWarnThreshold"
    | "reloadReviewThreshold"
    | "copyPasteReviewThreshold"
  >;
}): ClassifiedMonitoringOutcome {
  const { eventType, metadata, countersAfterEvent, policy } = params;

  if (eventType === "SEB_VERIFICATION_FAILED") {
    const copy = NEUTRAL_INCIDENT_COPY.BROWSER_POLICY_MISMATCH;
    return {
      severity: "REVIEW_REQUIRED",
      incidentCandidate: {
        reasonCode: "BROWSER_POLICY_MISMATCH",
        severity: "REVIEW_REQUIRED",
        title: copy.title,
        summary: copy.summary,
      },
    };
  }

  if (eventType === "EXAM_PAGE_VISIBLE") {
    const rawDuration = metadata?.hiddenDurationSeconds;
    const hiddenSeconds =
      typeof rawDuration === "number" && Number.isFinite(rawDuration)
        ? rawDuration
        : 0;
    if (hiddenSeconds >= policy.hiddenDurationReviewSeconds) {
      const copy = NEUTRAL_INCIDENT_COPY.PROLONGED_ABSENCE;
      return {
        severity: "REVIEW_REQUIRED",
        incidentCandidate: {
          reasonCode: "PROLONGED_ABSENCE",
          severity: "REVIEW_REQUIRED",
          title: copy.title,
          summary: `${copy.summary} (Durasi teramati: ~${Math.round(hiddenSeconds)} detik).`,
        },
      };
    }
    return { severity: "INFORMATIONAL", incidentCandidate: null };
  }

  if (eventType === "EXAM_PAGE_HIDDEN") {
    if (
      countersAfterEvent.visibilityHiddenCount >=
      policy.visibilitySwitchReviewThreshold
    ) {
      const copy = NEUTRAL_INCIDENT_COPY.REPEATED_VISIBILITY_SWITCHES;
      return {
        severity: "REVIEW_REQUIRED",
        incidentCandidate: {
          reasonCode: "REPEATED_VISIBILITY_SWITCHES",
          severity: "REVIEW_REQUIRED",
          title: copy.title,
          summary: `${copy.summary} (${countersAfterEvent.visibilityHiddenCount} kali perpindahan fokus).`,
        },
      };
    }
    if (
      countersAfterEvent.visibilityHiddenCount >=
      policy.visibilitySwitchWarnThreshold
    ) {
      return { severity: "WARNING", incidentCandidate: null };
    }
    return { severity: "INFORMATIONAL", incidentCandidate: null };
  }

  if (eventType === "EXAM_PAGE_RELOADED") {
    if (countersAfterEvent.reloadCount >= policy.reloadReviewThreshold) {
      const copy = NEUTRAL_INCIDENT_COPY.REPEATED_RELOADS;
      return {
        severity: "REVIEW_REQUIRED",
        incidentCandidate: {
          reasonCode: "REPEATED_RELOADS",
          severity: "REVIEW_REQUIRED",
          title: copy.title,
          summary: `${copy.summary} (${countersAfterEvent.reloadCount} kali muat ulang).`,
        },
      };
    }
    if (countersAfterEvent.reloadCount >= policy.reloadWarnThreshold) {
      return { severity: "WARNING", incidentCandidate: null };
    }
    return { severity: "INFORMATIONAL", incidentCandidate: null };
  }

  if (
    eventType === "COPY_EVENT_OBSERVED" ||
    eventType === "PASTE_EVENT_OBSERVED"
  ) {
    if (countersAfterEvent.copyPasteCount >= policy.copyPasteReviewThreshold) {
      const copy = NEUTRAL_INCIDENT_COPY.COPY_PASTE_BURST;
      return {
        severity: "REVIEW_REQUIRED",
        incidentCandidate: {
          reasonCode: "COPY_PASTE_BURST",
          severity: "REVIEW_REQUIRED",
          title: copy.title,
          summary: `${copy.summary} (${countersAfterEvent.copyPasteCount} kali kejadian).`,
        },
      };
    }
    return { severity: "WARNING", incidentCandidate: null };
  }

  if (eventType === "CONTEXT_MENU_EVENT_OBSERVED") {
    return { severity: "INFORMATIONAL", incidentCandidate: null };
  }

  if (eventType === "CONNECTION_GAP_OBSERVED") {
    if (countersAfterEvent.connectionGapCount >= 2) {
      const copy = NEUTRAL_INCIDENT_COPY.PROLONGED_DISCONNECTION;
      return {
        severity: "WARNING",
        incidentCandidate: {
          reasonCode: "PROLONGED_DISCONNECTION",
          severity: "WARNING",
          title: copy.title,
          summary: copy.summary,
        },
      };
    }
    return { severity: "WARNING", incidentCandidate: null };
  }

  return { severity: "INFORMATIONAL", incidentCandidate: null };
}

export function pairHiddenVisibleDurations(
  entries: readonly MonitoringActivityTimelineEntry[]
): HiddenVisibleDurationSpan[] {
  const ordered = [...entries].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  const spans: HiddenVisibleDurationSpan[] = [];
  let openHidden: MonitoringActivityTimelineEntry | null = null;

  for (const entry of ordered) {
    if (entry.eventType === "EXAM_PAGE_HIDDEN") {
      if (!openHidden) {
        openHidden = entry;
      }
      continue;
    }

    if (entry.eventType === "EXAM_PAGE_VISIBLE" && openHidden) {
      const startMs = new Date(openHidden.occurredAt).getTime();
      const endMs = new Date(entry.occurredAt).getTime();
      const durationSeconds =
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, Math.round((endMs - startMs) / 1000))
          : null;
      spans.push({
        hiddenAt: openHidden.occurredAt,
        visibleAt: entry.occurredAt,
        durationSeconds,
        source: openHidden.source,
      });
      openHidden = null;
    }
  }

  if (openHidden) {
    spans.push({
      hiddenAt: openHidden.occurredAt,
      visibleAt: null,
      durationSeconds: null,
      source: openHidden.source,
    });
  }

  return spans;
}

export function describeMonitoringEvent(eventType: MonitoringEventType): string {
  switch (eventType) {
    case "EXAM_SESSION_STARTED":
      return "Sesi ujian dimulai (Terkonfirmasi Server)";
    case "EXAM_SESSION_RESUMED":
      return "Sesi ujian dilanjutkan (Terkonfirmasi Server)";
    case "EXAM_SESSION_SUBMITTED":
      return "Ujian dikumpulkan (Terkonfirmasi Server)";
    case "EXAM_SESSION_EXPIRED":
      return "Batas waktu ujian berakhir (Terkonfirmasi Server)";
    case "EXAM_PAGE_VISIBLE":
      return "Halaman ujian kembali aktif di layar (Laporan Klien)";
    case "EXAM_PAGE_HIDDEN":
      return "Fokus halaman ujian berpindah ke latar belakang (Laporan Klien)";
    case "EXAM_PAGE_RELOADED":
      return "Halaman ujian dimuat ulang / dipulihkan (Laporan Klien)";
    case "EXAM_PAGE_NAVIGATION_OBSERVED":
      return "Navigasi keluar atau penutupan halaman teramati (Laporan Klien)";
    case "CONNECTION_GAP_OBSERVED":
      return "Kesenjangan konektivitas / heartbeat terlewati (Inferensi Server)";
    case "CONNECTION_RESTORED":
      return "Koneksi perangkat tersambung kembali (Laporan Klien)";
    case "COPY_EVENT_OBSERVED":
      return "Kejadian salin (copy) pada area non-isian (Laporan Klien)";
    case "PASTE_EVENT_OBSERVED":
      return "Kejadian tempel (paste) pada area non-isian (Laporan Klien)";
    case "CONTEXT_MENU_EVENT_OBSERVED":
      return "Menu konteks dibuka pada area soal (Laporan Klien)";
    case "EXAMBRO_HINT_REPORTED":
      return "Petunjuk peramban ExamBro Android diterima (Unverified Hint)";
    case "SEB_VERIFICATION_SUCCEEDED":
      return "Verifikasi kunci Safe Exam Browser berhasil (Terkonfirmasi Server)";
    case "SEB_VERIFICATION_FAILED":
      return "Verifikasi kunci Safe Exam Browser gagal (Terkonfirmasi Server)";
    case "BROWSER_POLICY_OVERRIDE_GRANTED":
      return "Pengecualian peramban darurat diberikan oleh pengawas (Terkonfirmasi Server)";
  }
}

/**
 * Neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`)
 * before escaping RFC 4180 CSV quotes.
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const needsFormulaGuard = /^[=+\-@\t\r]/.test(raw);
  const safe = needsFormulaGuard ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildSecurityReportCsv(report: ExamSecurityReportData): string {
  const lines: string[] = [];
  lines.push(
    [
      "Jenis Rekaman",
      "Nama Siswa",
      "NIS",
      "Kelas",
      "Status Sesi",
      "Status Koneksi",
      "Platform Peramban",
      "Tingkat Kepercayaan Peramban",
      "Pindah Fokus",
      "Muat Ulang",
      "Putus Koneksi",
      "Salin/Tempel",
      "Tingkat Keparahan",
      "Jumlah Insiden Terbuka",
      "Catatan / Penafian",
    ]
      .map(sanitizeCsvCell)
      .join(",")
  );

  lines.push(
    [
      "PENAFIAN",
      report.examTitle,
      "",
      report.subjectName,
      report.browserPolicy,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      report.disclaimer,
    ]
      .map(sanitizeCsvCell)
      .join(",")
  );

  for (const s of report.students) {
    lines.push(
      [
        "SISWA",
        s.studentName,
        s.studentNis ?? "",
        s.className ?? "",
        s.attemptStatus,
        s.presenceState,
        s.browserPlatform,
        s.browserTrustLevel,
        s.visibilityHiddenCount,
        s.reloadCount,
        s.connectionGapCount,
        s.copyPasteCount,
        s.highestSeverity,
        s.openIncidentCount,
        s.hasManualOverride ? "Dengan pengecualian pengawas" : "",
      ]
        .map(sanitizeCsvCell)
        .join(",")
    );
  }

  for (const inc of report.incidents) {
    lines.push(
      [
        "INSIDEN",
        inc.studentName,
        inc.studentNis ?? "",
        inc.className ?? "",
        inc.status,
        inc.reasonCode,
        "",
        "",
        inc.occurrenceCount,
        "",
        "",
        "",
        inc.severity,
        "",
        `${inc.title}: ${inc.resolutionSummary ?? inc.summary}`,
      ]
        .map(sanitizeCsvCell)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

export const SECURITY_REPORT_DISCLAIMER_ID =
  "Catatan: Sinyal fokus halaman, salin/tempel, dan petunjuk ExamBro Android berasal dari laporan peramban sisi klien atau inferensi jaringan dan BUKAN merupakan bukti kecurangan absolut. Hanya verifikasi kunci Safe Exam Browser serta waktu server mulai/kumpul yang diverifikasi secara otoritatif oleh server. Tinjauan manusia diperlukan sebelum mengambil keputusan apa pun.";
