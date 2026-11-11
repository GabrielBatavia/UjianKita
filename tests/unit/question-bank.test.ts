import { describe, expect, it } from "vitest";
import {
  normalizeQuestionFingerprint,
  validateQuestionDomainRules,
} from "@/domain/exams/question-rules";
import { renderSafeQuestionHtml } from "@/lib/question-content";
import { upsertQuestionSchema } from "@/schemas/exams";

describe("Question Bank domain validation & security", () => {
  it("accepts valid single_choice, multiple_choice, true_false, and essay configurations", () => {
    const sc = validateQuestionDomainRules({
      questionType: "single_choice",
      stem: "Berapakah hasil dari $2 + 3$?",
      points: 2,
      scoringPolicy: "exact_match",
      options: [
        { optionKey: "A", optionText: "4", displayOrder: 0 },
        { optionKey: "B", optionText: "5", displayOrder: 1 },
      ],
      correctOptionKeys: ["B"],
    });
    expect(sc.valid).toBe(true);

    const mc = validateQuestionDomainRules({
      questionType: "multiple_choice",
      stem: "Pilih bilangan prima",
      points: 4,
      scoringPolicy: "partial_credit_disabled",
      options: [
        { optionKey: "A", optionText: "2", displayOrder: 0 },
        { optionKey: "B", optionText: "4", displayOrder: 1 },
        { optionKey: "C", optionText: "5", displayOrder: 2 },
      ],
      correctOptionKeys: ["A", "C"],
    });
    expect(mc.valid).toBe(true);

    const tf = validateQuestionDomainRules({
      questionType: "true_false",
      stem: "Bumi mengelilingi matahari.",
      points: 1,
      scoringPolicy: "exact_match",
      options: [
        { optionKey: "TRUE", optionText: "Benar", displayOrder: 0 },
        { optionKey: "FALSE", optionText: "Salah", displayOrder: 1 },
      ],
      correctOptionKeys: ["TRUE"],
    });
    expect(tf.valid).toBe(true);

    const essay = validateQuestionDomainRules({
      questionType: "essay",
      stem: "Jelaskan hukum Newton II.",
      points: 10,
      scoringPolicy: "manual_rubric",
      options: [],
      correctOptionKeys: [],
    });
    expect(essay.valid).toBe(true);
  });

  it("rejects duplicate option keys, multiple answers on single_choice, and auto-gradable essays", () => {
    const dupKeys = validateQuestionDomainRules({
      questionType: "single_choice",
      stem: "Uji duplikat kunci",
      points: 2,
      scoringPolicy: "exact_match",
      options: [
        { optionKey: "A", optionText: "Satu", displayOrder: 0 },
        { optionKey: "a", optionText: "Dua", displayOrder: 1 },
      ],
      correctOptionKeys: ["A"],
    });
    expect(dupKeys.valid).toBe(false);

    const multiOnSingle = validateQuestionDomainRules({
      questionType: "single_choice",
      stem: "Uji dua jawaban pada pilihan tunggal",
      points: 2,
      scoringPolicy: "exact_match",
      options: [
        { optionKey: "A", optionText: "Satu", displayOrder: 0 },
        { optionKey: "B", optionText: "Dua", displayOrder: 1 },
      ],
      correctOptionKeys: ["A", "B"],
    });
    expect(multiOnSingle.valid).toBe(false);

    const autoEssay = validateQuestionDomainRules({
      questionType: "essay",
      stem: "Uji esai otomatis",
      points: 5,
      scoringPolicy: "exact_match",
      options: [],
      correctOptionKeys: [],
    });
    expect(autoEssay.valid).toBe(false);
  });

  it("rejects non-positive points and invalid Zod payloads", () => {
    const parsed = upsertQuestionSchema.safeParse({
      subjectId: "11111111-1111-4111-8111-111111111111",
      questionType: "single_choice",
      stem: "Apa ibukota Indonesia?",
      points: 0,
      options: [],
      correctOptionKeys: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("produces deterministic content fingerprints ignoring whitespace and casing", () => {
    const fp1 = normalizeQuestionFingerprint("single_choice", "Hasil  $2+2$  adalah?", [
      { optionKey: "A", optionText: " 4 ", displayOrder: 0 },
      { optionKey: "B", optionText: "5", displayOrder: 1 },
    ]);
    const fp2 = normalizeQuestionFingerprint("single_choice", "hasil $2+2$ adalah?", [
      { optionKey: "a", optionText: "4", displayOrder: 0 },
      { optionKey: "b", optionText: "5", displayOrder: 1 },
    ]);
    expect(fp1).toBe(fp2);
  });

  it("escapes XSS payloads while rendering KaTeX mathematics safely", () => {
    const html = renderSafeQuestionHtml(
      'Hitung $x^2 + 1$ <script>alert("xss")</script> <img src=x onerror=alert(1)>'
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("katex");
  });
});
