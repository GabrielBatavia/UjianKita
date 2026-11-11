import { createHash } from "node:crypto";
import type {
  QuestionOptionItem,
  QuestionType,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";

export interface QuestionDomainValidationInput {
  questionType: QuestionType;
  stem: string;
  points: number;
  scoringPolicy: ScoringPolicy;
  options: QuestionOptionItem[];
  correctOptionKeys: string[];
}

export interface QuestionDomainValidationResult {
  valid: boolean;
  errors: string[];
  normalizedOptions: QuestionOptionItem[];
  normalizedCorrectKeys: string[];
  normalizedScoringPolicy: ScoringPolicy;
}

export function normalizeQuestionFingerprint(
  questionType: QuestionType,
  stem: string,
  options: QuestionOptionItem[]
): string {
  const cleanStem = stem.trim().replace(/\s+/g, " ").toLowerCase();
  const cleanOptions = options
    .map((o) => `${o.optionKey.trim().toUpperCase()}:${o.optionText.trim().replace(/\s+/g, " ").toLowerCase()}`)
    .sort()
    .join("|");
  return createHash("sha256")
    .update(`${questionType}::${cleanStem}::${cleanOptions}`)
    .digest("hex");
}

export function validateQuestionDomainRules(
  input: QuestionDomainValidationInput
): QuestionDomainValidationResult {
  const errors: string[] = [];

  if (!input.stem || input.stem.trim().length < 3) {
    errors.push("Pertanyaan (stem) minimal 3 karakter.");
  }

  if (!Number.isFinite(input.points) || input.points <= 0 || input.points > 1000) {
    errors.push("Poin soal harus lebih besar dari 0 dan maksimal 1000.");
  }

  const normalizedOptions = input.options.map((opt, idx) => ({
    optionKey: opt.optionKey.trim().toUpperCase(),
    optionText: opt.optionText.trim(),
    displayOrder: Number.isInteger(opt.displayOrder) ? opt.displayOrder : idx,
  }));

  const normalizedCorrectKeys = Array.from(
    new Set(input.correctOptionKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))
  );

  // Check duplicate option keys
  const seenKeys = new Set<string>();
  for (const opt of normalizedOptions) {
    if (!opt.optionKey) {
      errors.push("Setiap pilihan jawaban wajib memiliki kode opsi (mis. A, B, C, D).");
      break;
    }
    if (!opt.optionText) {
      errors.push(`Teks pilihan untuk opsi ${opt.optionKey} tidak boleh kosong.`);
    }
    if (seenKeys.has(opt.optionKey)) {
      errors.push(`Kode opsi ganda terdeteksi: ${opt.optionKey}.`);
    }
    seenKeys.add(opt.optionKey);
  }

  let normalizedScoringPolicy = input.scoringPolicy;

  if (input.questionType === "essay") {
    if (normalizedScoringPolicy !== "manual_rubric") {
      errors.push("Soal esai wajib menggunakan kebijakan penilaian manual (manual_rubric).");
    }
    if (normalizedOptions.length > 0) {
      errors.push("Soal esai tidak boleh memiliki daftar opsi pilihan ganda.");
    }
    if (normalizedCorrectKeys.length > 0) {
      errors.push("Soal esai tidak menggunakan kunci opsi otomatis.");
    }
    return {
      valid: errors.length === 0,
      errors,
      normalizedOptions: [],
      normalizedCorrectKeys: [],
      normalizedScoringPolicy: "manual_rubric",
    };
  }

  // Non-essay questions must not use manual_rubric
  if (normalizedScoringPolicy === "manual_rubric") {
    errors.push("Soal objektif tidak dapat menggunakan mode penilaian manual esai.");
  }

  if (input.questionType === "true_false") {
    if (normalizedOptions.length !== 2) {
      errors.push("Soal Benar/Salah harus memiliki tepat 2 opsi (TRUE dan FALSE).");
    } else {
      const keys = normalizedOptions.map((o) => o.optionKey).sort();
      if (keys[0] !== "FALSE" || keys[1] !== "TRUE") {
        errors.push("Kode opsi Benar/Salah harus TRUE dan FALSE.");
      }
    }

    if (normalizedCorrectKeys.length !== 1) {
      errors.push("Soal Benar/Salah harus memiliki tepat 1 jawaban benar.");
    } else if (!normalizedCorrectKeys.every((k) => seenKeys.has(k))) {
      errors.push("Kunci jawaban Benar/Salah harus sesuai dengan opsi yang tersedia.");
    }
    normalizedScoringPolicy = "exact_match";
  }

  if (input.questionType === "single_choice") {
    if (normalizedOptions.length < 2 || normalizedOptions.length > 8) {
      errors.push("Soal pilihan ganda tunggal harus memiliki 2 hingga 8 pilihan jawaban.");
    }
    if (normalizedCorrectKeys.length !== 1) {
      errors.push("Soal pilihan ganda tunggal harus memiliki tepat 1 jawaban benar.");
    } else if (!normalizedCorrectKeys.every((k) => seenKeys.has(k))) {
      errors.push("Kunci jawaban harus merujuk pada salah satu opsi yang tersedia.");
    }
    normalizedScoringPolicy = "exact_match";
  }

  if (input.questionType === "multiple_choice") {
    if (normalizedOptions.length < 2 || normalizedOptions.length > 8) {
      errors.push("Soal pilihan ganda jamak harus memiliki 2 hingga 8 pilihan jawaban.");
    }
    if (normalizedCorrectKeys.length < 1) {
      errors.push("Soal pilihan ganda jamak harus memiliki minimal 1 kunci jawaban benar.");
    }
    if (!normalizedCorrectKeys.every((k) => seenKeys.has(k))) {
      errors.push("Semua kunci jawaban harus merujuk pada opsi yang tersedia.");
    }
    if (
      normalizedScoringPolicy !== "exact_match" &&
      normalizedScoringPolicy !== "partial_credit_disabled"
    ) {
      errors.push(
        "Soal pilihan ganda jamak wajib menentukan kebijakan exact_match atau partial_credit_disabled."
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedOptions,
    normalizedCorrectKeys,
    normalizedScoringPolicy,
  };
}
