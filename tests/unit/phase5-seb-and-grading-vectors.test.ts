import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeAttemptGradeBreakdown,
  evaluateObjectiveQuestionResponse,
} from "@/domain/exams/grading";
import {
  canonicalizeSebJson,
  computeSebConfigKeyFromObject,
  computeSebConfigKeyFromPlistXml,
  computeSebRequestHash,
  verifySebKeyProof,
} from "@/domain/monitoring/seb-verification";

function independentSha256(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex").toLowerCase();
}

describe("Phase 5 Independent SEB Cryptographic Interoperability Vectors", () => {
  it("matches independently computed SHA-256 of canonical SEB-JSON (including ordinal sort, empty-dict omission, and originatorVersion stripping)", () => {
    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>originatorVersion</key>
  <string>SEB_Win_3.7.0</string>
  <key>startURL</key>
  <string>https://ujian.sekolah.sch.id/student/exams/exam-42?token=alpha&amp;lang=id</string>
  <key>allowSpellCheck</key>
  <false/>
  <key>URLFilterEnable</key>
  <true/>
  <key>emptyLegacyDict</key>
  <dict/>
  <key>nestedWrapper</key>
  <dict>
    <key>onlyEmptyChild</key>
    <dict/>
  </dict>
  <key>browserWindowAllowReload</key>
  <true/>
</dict>
</plist>`;

    // Per SEB Config Key spec:
    // - ASCII/UTF-16 ordinal sort puts uppercase ('U') before lowercase ('a','b','s')
    // - originatorVersion and empty dicts (recursively) are omitted
    // - &amp; decodes to '&' in XML text
    const expectedCanonicalSebJson =
      '{"URLFilterEnable":true,"allowSpellCheck":false,"browserWindowAllowReload":true,"startURL":"https://ujian.sekolah.sch.id/student/exams/exam-42?token=alpha&lang=id"}';
    const expectedConfigKey = independentSha256(expectedCanonicalSebJson);

    expect(
      canonicalizeSebJson({
        URLFilterEnable: true,
        allowSpellCheck: false,
        emptyLegacyDict: {},
        nestedWrapper: { onlyEmptyChild: {} },
        browserWindowAllowReload: true,
        startURL: "https://ujian.sekolah.sch.id/student/exams/exam-42?token=alpha&lang=id",
      })
    ).toBe(expectedCanonicalSebJson);

    expect(computeSebConfigKeyFromPlistXml(plistXml)).toBe(expectedConfigKey);
    expect(
      computeSebConfigKeyFromObject({
        originatorVersion: "SEB_macOS_3.3",
        browserWindowAllowReload: true,
        URLFilterEnable: true,
        allowSpellCheck: false,
        emptyLegacyDict: {},
        nestedWrapper: { onlyEmptyChild: {} },
        startURL: "https://ujian.sekolah.sch.id/student/exams/exam-42?token=alpha&lang=id",
      })
    ).toBe(expectedConfigKey);
  });

  it("matches independently computed SEB Request Hash SHA-256(urlWithoutFragment + configKeyHex)", () => {
    const configKeyHex = independentSha256(
      '{"allowQuit":true,"startURL":"https://ujian.sekolah.sch.id/student/exams/11111111-1111-4111-8111-111111111111"}'
    );
    const fullUrlWithFragment =
      "https://ujian.sekolah.sch.id/student/exams/11111111-1111-4111-8111-111111111111?attempt=1#soal-3";
    const normalizedUrl =
      "https://ujian.sekolah.sch.id/student/exams/11111111-1111-4111-8111-111111111111?attempt=1";

    const expectedHeaderDigest = independentSha256(`${normalizedUrl}${configKeyHex}`);
    expect(computeSebRequestHash(fullUrlWithFragment, configKeyHex)).toBe(expectedHeaderDigest);

    const outcome = verifySebKeyProof({
      requestUrl: fullUrlWithFragment,
      expectedOrigin: "https://ujian.sekolah.sch.id",
      examId: "11111111-1111-4111-8111-111111111111",
      expectedConfigKeyHex: configKeyHex,
      expectedBrowserExamKeyHex: null,
      headerConfigKeyHash: expectedHeaderDigest,
    });
    expect(outcome.verified).toBe(true);
    expect(outcome.trustLevel).toBe("verified_seb_header_and_key");
    expect(outcome.normalizedUrl).toBe(normalizedUrl);

    // Query parameter tampering invalidates the SEB request hash
    const tampered = verifySebKeyProof({
      requestUrl:
        "https://ujian.sekolah.sch.id/student/exams/11111111-1111-4111-8111-111111111111?attempt=2",
      expectedOrigin: "https://ujian.sekolah.sch.id",
      examId: "11111111-1111-4111-8111-111111111111",
      expectedConfigKeyHex: configKeyHex,
      expectedBrowserExamKeyHex: null,
      headerConfigKeyHash: expectedHeaderDigest,
    });
    expect(tampered.verified).toBe(false);
    expect(tampered.trustLevel).toBe("standard_browser");
  });
});

describe("Phase 5 Exhaustive Objective & Mixed Grading Fixtures", () => {
  it("evaluates single_choice, multiple_choice (shuffled vs exact), true_false, null response, and essays cleanly", () => {
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "single_choice",
        scoringPolicy: "exact_match",
        maxPoints: 15,
        correctOptionKeys: ["C"],
        response: { questionType: "single_choice", canonicalOptionKey: "C" },
      })
    ).toEqual({
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: true,
      awardedPoints: 15,
    });

    // Multiple choice out of order matches canonical set
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "multiple_choice",
        scoringPolicy: "exact_match",
        maxPoints: 20,
        correctOptionKeys: ["B", "D"],
        response: { questionType: "multiple_choice", canonicalOptionKeys: ["D", "B"] },
      })
    ).toEqual({
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: true,
      awardedPoints: 20,
    });

    // Partial selection on multiple_choice exact_match scores 0 (no partial hallucination)
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "multiple_choice",
        scoringPolicy: "exact_match",
        maxPoints: 20,
        correctOptionKeys: ["B", "D"],
        response: { questionType: "multiple_choice", canonicalOptionKeys: ["B"] },
      })
    ).toEqual({
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: false,
      awardedPoints: 0,
    });

    // Extra wrong option on multiple_choice scores 0
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "multiple_choice",
        scoringPolicy: "exact_match",
        maxPoints: 20,
        correctOptionKeys: ["B", "D"],
        response: { questionType: "multiple_choice", canonicalOptionKeys: ["A", "B", "D"] },
      })
    ).toEqual({
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: false,
      awardedPoints: 0,
    });

    // True/false
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "true_false",
        scoringPolicy: "exact_match",
        maxPoints: 10,
        correctOptionKeys: ["FALSE"],
        response: { questionType: "true_false", canonicalOptionKey: "FALSE" },
      }).awardedPoints
    ).toBe(10);

    // Null/unanswered scores 0
    expect(
      evaluateObjectiveQuestionResponse({
        questionType: "single_choice",
        scoringPolicy: "exact_match",
        maxPoints: 10,
        correctOptionKeys: ["A"],
        response: null,
      })
    ).toEqual({
      isObjective: true,
      requiresManualGrading: false,
      isCorrect: false,
      awardedPoints: 0,
    });
  });

  it("computes total score, percentage rounding, passing threshold, and adjustment delta accurately", () => {
    const pendingBreakdown = computeAttemptGradeBreakdown({
      passingScore: 70,
      adjustmentDelta: 0,
      questions: [
        {
          examVersionQuestionId: "q1",
          questionType: "single_choice",
          scoringPolicy: "exact_match",
          maxPoints: 20,
          correctOptionKeys: ["A"],
          response: { questionType: "single_choice", canonicalOptionKey: "A" },
        },
        {
          examVersionQuestionId: "q2",
          questionType: "essay",
          scoringPolicy: "manual_rubric",
          maxPoints: 80,
          correctOptionKeys: [],
          response: { questionType: "essay", textAnswer: "Jawaban esai" },
          manualAssignedScore: null,
        },
      ],
    });
    expect(pendingBreakdown.gradingStatus).toBe("PENDING_MANUAL_REVIEW");
    expect(pendingBreakdown.pendingManualCount).toBe(1);
    expect(pendingBreakdown.totalScore).toBe(20);
    expect(pendingBreakdown.passed).toBe(false);

    const completeAdjusted = computeAttemptGradeBreakdown({
      passingScore: 70,
      adjustmentDelta: 5,
      questions: [
        {
          examVersionQuestionId: "q1",
          questionType: "single_choice",
          scoringPolicy: "exact_match",
          maxPoints: 20,
          correctOptionKeys: ["A"],
          response: { questionType: "single_choice", canonicalOptionKey: "A" },
        },
        {
          examVersionQuestionId: "q2",
          questionType: "essay",
          scoringPolicy: "manual_rubric",
          maxPoints: 80,
          correctOptionKeys: [],
          response: { questionType: "essay", textAnswer: "Jawaban esai" },
          manualAssignedScore: 55,
        },
      ],
    });
    expect(completeAdjusted.gradingStatus).toBe("ADJUSTED");
    expect(completeAdjusted.objectiveScore).toBe(20);
    expect(completeAdjusted.manualScore).toBe(55);
    expect(completeAdjusted.adjustmentDelta).toBe(5);
    expect(completeAdjusted.totalScore).toBe(80);
    expect(completeAdjusted.percentageScore).toBe(80);
    expect(completeAdjusted.passed).toBe(true);
  });
});
