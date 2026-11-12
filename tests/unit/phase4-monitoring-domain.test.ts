import { describe, expect, it } from "vitest";
import {
  assessExamBroClientHint,
  EXAMBRO_PACKAGE_ID,
  generateQrCodeSvg,
} from "@/domain/monitoring/exambro-compat";
import { createDefaultSecurityPolicy } from "@/domain/monitoring/phase4-types";
import {
  buildSecurityReportCsv,
  classifyEventAndEvaluateIncident,
  enforceAuthoritativeEventSource,
  inferConnectionPresenceState,
  pairHiddenVisibleDurations,
  sanitizeCsvCell,
  SECURITY_REPORT_DISCLAIMER_ID,
} from "@/domain/monitoring/presence-and-incidents";
import {
  buildSebExamProfile,
  canonicalizeSebJson,
  computeSebConfigKeyFromObject,
  computeSebConfigKeyFromPlistXml,
  computeSebRequestHash,
  isAllowedSebProofUrl,
  normalizeSebUrl,
  sha256Hex,
  verifySebKeyProof,
} from "@/domain/monitoring/seb-verification";

describe("Phase 4 Safe Exam Browser (SEB) Protocol & Crypto", () => {
  it("normalizes SEB URLs by removing #fragments while preserving path and query string", () => {
    expect(
      normalizeSebUrl("https://ujiankita.sch.id/student/exams/abc-123?mode=seb#section-1")
    ).toBe("https://ujiankita.sch.id/student/exams/abc-123?mode=seb");

    expect(
      normalizeSebUrl("https://ujiankita.sch.id/student/exams/abc-123#")
    ).toBe("https://ujiankita.sch.id/student/exams/abc-123");
  });

  it("canonicalizes SEB JSON with lexicographically sorted keys and strips originatorVersion", () => {
    const rawA = {
      originatorVersion: "SEB_iOS_3.4",
      startURL: "https://ujiankita.sch.id/exam",
      allowQuit: true,
      nested: { zKey: 2, aKey: 1 },
    };
    const rawB = {
      allowQuit: true,
      nested: { aKey: 1, zKey: 2 },
      startURL: "https://ujiankita.sch.id/exam",
    };

    expect(canonicalizeSebJson(rawB)).toBe(
      '{"allowQuit":true,"nested":{"aKey":1,"zKey":2},"startURL":"https://ujiankita.sch.id/exam"}'
    );
    expect(computeSebConfigKeyFromObject(rawA)).toBe(
      computeSebConfigKeyFromObject(rawB)
    );
    expect(computeSebConfigKeyFromObject(rawA)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates a valid .seb plist XML whose ConfigKey matches its canonical JSON hash", () => {
    const built = buildSebExamProfile({
      startUrl: "https://ujiankita.sch.id/student/exams/exam-101#top",
      examTitle: "UTS Matematika <X>",
    });

    expect(built.plistXml).toContain("<plist version=\"1.0\">");
    expect(built.plistXml).toContain(
      "<string>https://ujiankita.sch.id/student/exams/exam-101</string>"
    );
    expect(computeSebConfigKeyFromPlistXml(built.plistXml)).toBe(built.configKeyHex);
    expect(computeSebConfigKeyFromObject(built.configObject)).toBe(built.configKeyHex);
  });

  it("computes official SEB request hash as SHA-256(normalizedUrl + keyHex)", () => {
    const url = "https://ujiankita.sch.id/student/exams/exam-101";
    const configKey = sha256Hex("seb-config-fixture");
    const expected = sha256Hex(`${url}${configKey}`);

    expect(computeSebRequestHash(`${url}#frag`, configKey)).toBe(expected);
  });

  it("verifies SEB JS callback keys and headers using constant-time comparison and blocks foreign URLs", () => {
    const examId = "11111111-1111-4111-8111-111111111111";
    const origin = "https://ujiankita.sch.id";
    const pageUrl = `${origin}/student/exams/${examId}`;
    const expectedConfigKey = sha256Hex("cfg-key-test");
    const expectedBek = sha256Hex("bek-key-test");

    const jsConfigHash = computeSebRequestHash(pageUrl, expectedConfigKey);
    const jsBekHash = computeSebRequestHash(pageUrl, expectedBek);

    const jsResult = verifySebKeyProof({
      requestUrl: `${pageUrl}#ignored`,
      expectedOrigin: origin,
      examId,
      expectedConfigKeyHex: expectedConfigKey,
      expectedBrowserExamKeyHex: expectedBek,
      submittedConfigKeyHash: jsConfigHash,
      submittedBrowserExamKeyHash: jsBekHash,
    });
    expect(jsResult.verified).toBe(true);
    expect(jsResult.trustLevel).toBe("verified_seb_js_key");

    const headerResult = verifySebKeyProof({
      requestUrl: pageUrl,
      expectedOrigin: origin,
      examId,
      expectedConfigKeyHex: expectedConfigKey,
      expectedBrowserExamKeyHex: null,
      headerConfigKeyHash: jsConfigHash,
    });
    expect(headerResult.verified).toBe(true);
    expect(headerResult.trustLevel).toBe("verified_seb_header_and_key");

    const spoofedExamUrl = verifySebKeyProof({
      requestUrl: `${origin}/student/exams/other-exam`,
      expectedOrigin: origin,
      examId,
      expectedConfigKeyHex: expectedConfigKey,
      expectedBrowserExamKeyHex: null,
      submittedConfigKeyHash: computeSebRequestHash(
        `${origin}/student/exams/other-exam`,
        expectedConfigKey
      ),
    });
    expect(spoofedExamUrl.verified).toBe(false);
    expect(isAllowedSebProofUrl("https://evil.example.com/student/exams/x", origin, examId)).toBe(
      false
    );
  });
});

describe("Phase 4 Android ExamBro Compatibility & QR Generation", () => {
  it("never classifies Android ExamBro hints or User-Agents as cryptographic verification", () => {
    const uaHint = assessExamBroClientHint({
      userAgent: `Mozilla/5.0 Android ${EXAMBRO_PACKAGE_ID}`,
      declaredPlatform: "ANDROID_EXAMBRO",
      exambroDetectedHint: true,
    });

    expect(uaHint.platform).toBe("ANDROID_EXAMBRO");
    expect(uaHint.trustLevel).toBe("unverified_client_hint");
    expect(uaHint.canServeAsCryptographicProof).toBe(false);

    const std = assessExamBroClientHint({
      userAgent: "Mozilla/5.0 Chrome/120.0",
    });
    expect(std.trustLevel).toBe("standard_browser");
    expect(std.canServeAsCryptographicProof).toBe(false);
  });

  it("generates deterministic, crisp SVG QR codes for ExamBro scanning", () => {
    const svg = generateQrCodeSvg("https://ujiankita.sch.id/student/exams/abc-123");
    expect(svg).toContain("<svg");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("shape-rendering=\"crispEdges\"");
    expect(svg).toBe(generateQrCodeSvg("https://ujiankita.sch.id/student/exams/abc-123"));
  });
});

describe("Phase 4 Connection Presence, Severity & Safe Reporting", () => {
  it("infers RECENTLY_SEEN, STALE, UNKNOWN, and ENDED states accurately", () => {
    const now = new Date("2026-11-12T08:02:00.000Z");

    expect(
      inferConnectionPresenceState({
        attemptStatus: "IN_PROGRESS",
        lastHeartbeatAt: "2026-11-12T08:01:25.000Z",
        now,
        staleThresholdSeconds: 90,
      }).state
    ).toBe("RECENTLY_SEEN");

    expect(
      inferConnectionPresenceState({
        attemptStatus: "IN_PROGRESS",
        lastHeartbeatAt: "2026-11-12T08:00:00.000Z",
        now,
        staleThresholdSeconds: 90,
      }).state
    ).toBe("STALE");

    expect(
      inferConnectionPresenceState({
        attemptStatus: "IN_PROGRESS",
        lastHeartbeatAt: null,
        now,
      }).state
    ).toBe("UNKNOWN");

    expect(
      inferConnectionPresenceState({
        attemptStatus: "SUBMITTED",
        lastHeartbeatAt: "2026-11-12T07:50:00.000Z",
        now,
      }).state
    ).toBe("ENDED");
  });

  it("enforces authoritative event source and classifies thresholds without accusatory terms", () => {
    expect(enforceAuthoritativeEventSource("EXAM_PAGE_HIDDEN")).toBe("CLIENT_REPORTED");
    expect(enforceAuthoritativeEventSource("CONNECTION_GAP_OBSERVED")).toBe("SERVER_INFERRED");
    expect(enforceAuthoritativeEventSource("SEB_VERIFICATION_SUCCEEDED")).toBe("SERVER_CONFIRMED");

    const policy = createDefaultSecurityPolicy({ examId: "ex-1", schoolId: "sc-1" });
    const prolonged = classifyEventAndEvaluateIncident({
      eventType: "EXAM_PAGE_VISIBLE",
      metadata: { hiddenDurationSeconds: 75 },
      countersAfterEvent: {
        visibilityHiddenCount: 1,
        reloadCount: 0,
        connectionGapCount: 0,
        copyPasteCount: 0,
        contextMenuCount: 0,
      },
      policy,
    });

    expect(prolonged.severity).toBe("REVIEW_REQUIRED");
    expect(prolonged.incidentCandidate?.reasonCode).toBe("PROLONGED_ABSENCE");
    expect(prolonged.incidentCandidate?.title.toLowerCase()).not.toContain("curang");
  });

  it("pairs hidden/visible durations accurately and neutralizes CSV formula injection", () => {
    const spans = pairHiddenVisibleDurations([
      {
        id: "1",
        eventType: "EXAM_PAGE_HIDDEN",
        source: "CLIENT_REPORTED",
        severity: "INFORMATIONAL",
        occurredAt: "2026-11-12T08:01:00.000Z",
        recordedAt: "2026-11-12T08:01:01.000Z",
        title: "",
        detail: "",
        metadata: {},
      },
      {
        id: "2",
        eventType: "EXAM_PAGE_VISIBLE",
        source: "CLIENT_REPORTED",
        severity: "INFORMATIONAL",
        occurredAt: "2026-11-12T08:02:15.000Z",
        recordedAt: "2026-11-12T08:02:16.000Z",
        title: "",
        detail: "",
        metadata: {},
      },
    ]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.durationSeconds).toBe(75);

    expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe('"\'=cmd|\' /C calc\'!A0"');
    expect(sanitizeCsvCell("+SUM(A1:A2)")).toBe('"\'+SUM(A1:A2)"');

    const csv = buildSecurityReportCsv({
      generatedAt: "2026-11-12T09:00:00.000Z",
      examId: "ex-1",
      examTitle: "UTS Biologi",
      subjectName: "Biologi",
      browserPolicy: "STANDARD_BROWSER_ALLOWED",
      disclaimer: SECURITY_REPORT_DISCLAIMER_ID,
      summary: {
        totalAssigned: 1,
        notStartedCount: 0,
        inProgressCount: 1,
        submittedCount: 0,
        expiredCount: 0,
        recentlySeenCount: 1,
        staleCount: 0,
        unknownPresenceCount: 0,
        reviewRequiredCount: 0,
        openIncidentCount: 0,
        sebVerifiedCount: 0,
        exambroHintCount: 0,
      },
      students: [
        {
          attemptId: "att-1",
          studentId: "st-1",
          studentName: "@EvilFormulaName",
          studentNis: "1001",
          classId: "c-1",
          className: "X IPA 1",
          attemptStatus: "IN_PROGRESS",
          presenceState: "RECENTLY_SEEN",
          lastHeartbeatAt: "2026-11-12T08:59:50.000Z",
          secondsSinceLastHeartbeat: 10,
          startedAt: "2026-11-12T08:00:00.000Z",
          effectiveDeadlineAt: "2026-11-12T09:30:00.000Z",
          submittedAt: null,
          answeredCount: 5,
          totalQuestions: 20,
          progressPercent: 25,
          browserPlatform: "STANDARD_WEB",
          browserTrustLevel: "standard_browser",
          visibilityHiddenCount: 0,
          reloadCount: 0,
          connectionGapCount: 0,
          copyPasteCount: 0,
          contextMenuCount: 0,
          highestSeverity: "INFORMATIONAL",
          openIncidentCount: 0,
          hasManualOverride: false,
        },
      ],
      incidents: [],
    });

    expect(csv).toContain("BUKAN merupakan bukti kecurangan absolut");
    expect(csv).toContain("'@EvilFormulaName");
  });
});
