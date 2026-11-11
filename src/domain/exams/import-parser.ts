import ExcelJS from "exceljs";
import Papa from "papaparse";
import type {
  QuestionDifficulty,
  QuestionOptionItem,
  QuestionType,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";
import {
  normalizeQuestionFingerprint,
  validateQuestionDomainRules,
} from "@/domain/exams/question-rules";
import { sanitizePlainQuestionText } from "@/lib/question-content";

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_IMPORT_ROWS = 500;

export const IMPORT_TEMPLATE_HEADERS = [
  "question_type",
  "difficulty",
  "topic",
  "tags",
  "points",
  "scoring_policy",
  "stem",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "correct_answers",
  "explanation",
  "rubric_notes",
  "preserve_option_order",
] as const;

export interface ParsedImportQuestionRow {
  rowNumber: number;
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  topic: string | null;
  tags: string[];
  points: number;
  scoringPolicy: ScoringPolicy;
  stem: string;
  explanation: string | null;
  rubricNotes: string | null;
  preserveOptionOrder: boolean;
  options: QuestionOptionItem[];
  correctOptionKeys: string[];
  fingerprint: string;
  status: "active";
}

export interface RejectedImportRow {
  rowNumber: number;
  reason: string;
  rawStem: string;
  isDuplicate: boolean;
}

export interface ImportParseResult {
  fileFormat: "csv" | "xlsx";
  totalRows: number;
  validRows: ParsedImportQuestionRow[];
  rejectedRows: RejectedImportRow[];
  duplicateCount: number;
}

function mapQuestionType(raw: string): QuestionType | null {
  const norm = raw.trim().toLowerCase();
  if (norm === "single_choice" || norm === "pilihan_ganda" || norm === "pg") return "single_choice";
  if (norm === "multiple_choice" || norm === "pilihan_jamak" || norm === "mcma") {
    return "multiple_choice";
  }
  if (norm === "true_false" || norm === "benar_salah" || norm === "tf") return "true_false";
  if (norm === "essay" || norm === "esai" || norm === "uraian") return "essay";
  return null;
}

function mapDifficulty(raw: string): QuestionDifficulty | null {
  const norm = raw.trim().toLowerCase();
  if (!norm || norm === "medium" || norm === "sedang") return "medium";
  if (norm === "easy" || norm === "mudah") return "easy";
  if (norm === "hard" || norm === "sulit") return "hard";
  return null;
}

function hasSpreadsheetFormulaPrefix(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("=") || trimmed.startsWith("+cmd|") || trimmed.startsWith("@SUM");
}

function extractSafeCellText(cellValue: ExcelJS.CellValue): { text: string; hasFormula: boolean } {
  if (cellValue === null || cellValue === undefined) {
    return { text: "", hasFormula: false };
  }
  if (typeof cellValue === "object") {
    if ("formula" in cellValue || "sharedFormula" in cellValue) {
      return { text: "", hasFormula: true };
    }
    if ("richText" in cellValue && Array.isArray(cellValue.richText)) {
      return {
        text: cellValue.richText.map((part) => part.text).join(""),
        hasFormula: false,
      };
    }
    if ("text" in cellValue && typeof cellValue.text === "string") {
      return { text: cellValue.text, hasFormula: false };
    }
  }
  const str = String(cellValue);
  return { text: str, hasFormula: hasSpreadsheetFormulaPrefix(str) };
}

function parseBooleanFlag(raw: string): boolean {
  const norm = raw.trim().toLowerCase();
  return norm === "true" || norm === "ya" || norm === "1" || norm === "yes";
}

function validateAndBuildRow(params: {
  rowNumber: number;
  cells: Record<string, string>;
  hasFormulaCell: boolean;
  existingFingerprints: Set<string>;
  seenInBatchFingerprints: Set<string>;
}): { valid?: ParsedImportQuestionRow; rejected?: RejectedImportRow } {
  const { rowNumber, cells, hasFormulaCell, existingFingerprints, seenInBatchFingerprints } = params;
  const stem = sanitizePlainQuestionText(cells.stem ?? "");

  if (hasFormulaCell) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem || "(sel formula)",
        reason: "Sel mengandung formula spreadsheet yang tidak diizinkan demi keamanan.",
        isDuplicate: false,
      },
    };
  }

  const questionType = mapQuestionType(cells.question_type ?? "");
  if (!questionType) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem,
        reason: `Tipe soal tidak valid ("${cells.question_type ?? ""}"). Gunakan: single_choice, multiple_choice, true_false, atau essay.`,
        isDuplicate: false,
      },
    };
  }

  const difficulty = mapDifficulty(cells.difficulty ?? "");
  if (!difficulty) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem,
        reason: `Tingkat kesulitan tidak valid ("${cells.difficulty ?? ""}"). Gunakan: easy, medium, atau hard.`,
        isDuplicate: false,
      },
    };
  }

  const points = Number(cells.points || "1");
  if (!Number.isFinite(points) || points <= 0) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem,
        reason: `Poin harus berupa angka positif (diterima: "${cells.points ?? ""}").`,
        isDuplicate: false,
      },
    };
  }

  let options: QuestionOptionItem[] = [];
  if (questionType === "true_false") {
    options = [
      { optionKey: "TRUE", optionText: sanitizePlainQuestionText(cells.option_a || "Benar"), displayOrder: 0 },
      { optionKey: "FALSE", optionText: sanitizePlainQuestionText(cells.option_b || "Salah"), displayOrder: 1 },
    ];
  } else if (questionType !== "essay") {
    const candidateKeys = [
      { key: "A", val: cells.option_a ?? "" },
      { key: "B", val: cells.option_b ?? "" },
      { key: "C", val: cells.option_c ?? "" },
      { key: "D", val: cells.option_d ?? "" },
      { key: "E", val: cells.option_e ?? "" },
    ];
    candidateKeys.forEach((entry) => {
      const cleaned = sanitizePlainQuestionText(entry.val);
      if (cleaned) {
        options.push({
          optionKey: entry.key,
          optionText: cleaned,
          displayOrder: options.length,
        });
      }
    });
  }

  let correctOptionKeys = (cells.correct_answers ?? "")
    .split(/[,;|]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (questionType === "true_false") {
    correctOptionKeys = correctOptionKeys.map((k) =>
      k === "A" || k === "BENAR" || k === "TRUE" ? "TRUE" : k === "B" || k === "SALAH" || k === "FALSE" ? "FALSE" : k
    );
  }

  const rawPolicy = (cells.scoring_policy ?? "").trim().toLowerCase();
  let scoringPolicy: ScoringPolicy =
    questionType === "essay"
      ? "manual_rubric"
      : rawPolicy === "partial_credit_disabled"
        ? "partial_credit_disabled"
        : "exact_match";

  if (rawPolicy === "manual_rubric") {
    scoringPolicy = "manual_rubric";
  }

  const domainValidation = validateQuestionDomainRules({
    questionType,
    stem,
    points,
    scoringPolicy,
    options,
    correctOptionKeys,
  });

  if (!domainValidation.valid) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem,
        reason: domainValidation.errors.join(" "),
        isDuplicate: false,
      },
    };
  }

  const fingerprint = normalizeQuestionFingerprint(
    questionType,
    stem,
    domainValidation.normalizedOptions
  );

  if (existingFingerprints.has(fingerprint) || seenInBatchFingerprints.has(fingerprint)) {
    return {
      rejected: {
        rowNumber,
        rawStem: stem,
        reason: "Soal terdeteksi duplikat dengan soal di bank soal atau baris lain pada berkas ini.",
        isDuplicate: true,
      },
    };
  }

  seenInBatchFingerprints.add(fingerprint);

  const tags = (cells.tags ?? "")
    .split(/[,;|]/)
    .map((t) => sanitizePlainQuestionText(t))
    .filter(Boolean)
    .slice(0, 12);

  return {
    valid: {
      rowNumber,
      questionType,
      difficulty,
      topic: sanitizePlainQuestionText(cells.topic ?? "") || null,
      tags,
      points,
      scoringPolicy: domainValidation.normalizedScoringPolicy,
      stem,
      explanation: sanitizePlainQuestionText(cells.explanation ?? "") || null,
      rubricNotes: sanitizePlainQuestionText(cells.rubric_notes ?? "") || null,
      preserveOptionOrder: parseBooleanFlag(cells.preserve_option_order ?? ""),
      options: domainValidation.normalizedOptions,
      correctOptionKeys: domainValidation.normalizedCorrectKeys,
      fingerprint,
      status: "active",
    },
  };
}

export async function parseQuestionImportFile(params: {
  fileName: string;
  buffer: ArrayBuffer;
  existingFingerprints: Set<string>;
}): Promise<ImportParseResult> {
  const { fileName, buffer, existingFingerprints } = params;

  if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error("Ukuran berkas melebihi batas maksimal 2 MB.");
  }

  const lower = fileName.toLowerCase();
  const isCsv = lower.endsWith(".csv");
  const isXlsx = lower.endsWith(".xlsx");

  if (!isCsv && !isXlsx) {
    throw new Error("Format berkas harus .csv atau .xlsx.");
  }

  const rawRows: Array<{ rowNumber: number; cells: Record<string, string>; hasFormulaCell: boolean }> =
    [];

  if (isCsv) {
    const text = new TextDecoder("utf-8").decode(buffer);
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`Berkas CSV tidak dapat dibaca: ${parsed.errors[0]?.message ?? "malformed"}`);
    }

    if (parsed.data.length > MAX_IMPORT_ROWS) {
      throw new Error(`Jumlah baris melebihi batas maksimal ${MAX_IMPORT_ROWS} soal per impor.`);
    }

    parsed.data.forEach((row, idx) => {
      const cells: Record<string, string> = {};
      let hasFormulaCell = false;
      for (const [key, val] of Object.entries(row)) {
        const str = typeof val === "string" ? val : String(val ?? "");
        if (hasSpreadsheetFormulaPrefix(str)) {
          hasFormulaCell = true;
        }
        cells[key] = str;
      }
      rawRows.push({ rowNumber: idx + 2, cells, hasFormulaCell });
    });
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error("Berkas XLSX tidak memiliki lembar kerja.");
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = extractSafeCellText(cell.value).text.trim().toLowerCase();
    });

    if (!headers.includes("question_type") || !headers.includes("stem")) {
      throw new Error("Template XLSX tidak valid: kolom wajib 'question_type' dan 'stem' tidak ditemukan.");
    }

    if (sheet.rowCount - 1 > MAX_IMPORT_ROWS) {
      throw new Error(`Jumlah baris melebihi batas maksimal ${MAX_IMPORT_ROWS} soal per impor.`);
    }

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const cells: Record<string, string> = {};
      let hasContent = false;
      let hasFormulaCell = false;

      headers.forEach((header, colNumber) => {
        if (!header) return;
        const extracted = extractSafeCellText(row.getCell(colNumber).value);
        if (extracted.hasFormula) hasFormulaCell = true;
        if (extracted.text.trim()) hasContent = true;
        cells[header] = extracted.text;
      });

      if (hasContent || hasFormulaCell) {
        rawRows.push({ rowNumber: r, cells, hasFormulaCell });
      }
    }
  }

  if (rawRows.length === 0) {
    throw new Error("Berkas tidak mengandung baris soal untuk diimpor.");
  }

  const seenInBatch = new Set<string>();
  const validRows: ParsedImportQuestionRow[] = [];
  const rejectedRows: RejectedImportRow[] = [];

  for (const raw of rawRows) {
    const res = validateAndBuildRow({
      rowNumber: raw.rowNumber,
      cells: raw.cells,
      hasFormulaCell: raw.hasFormulaCell,
      existingFingerprints,
      seenInBatchFingerprints: seenInBatch,
    });
    if (res.valid) validRows.push(res.valid);
    if (res.rejected) rejectedRows.push(res.rejected);
  }

  return {
    fileFormat: isCsv ? "csv" : "xlsx",
    totalRows: rawRows.length,
    validRows,
    rejectedRows,
    duplicateCount: rejectedRows.filter((r) => r.isDuplicate).length,
  };
}

export function generateCsvImportTemplate(): string {
  const sampleRows = [
    IMPORT_TEMPLATE_HEADERS.join(","),
    'single_choice,easy,"Persamaan Linear","aljabar,kelas10",2,exact_match,"Nilai x dari persamaan $2x + 4 = 10$ adalah...","2","3","4","5","","B","2x = 6 sehingga x = 3","",false',
    'multiple_choice,medium,"Bilangan Prima","aritmetika",3,exact_match,"Manakah di antara bilangan berikut yang merupakan bilangan prima?","2","4","5","9","","A,C","2 dan 5 hanya habis dibagi 1 dan dirinya sendiri","",false',
    'true_false,easy,"Geometri Dasar","segitiga",1,exact_match,"Jumlah sudut dalam segitiga datar selalu $180^\\circ$.","Benar","Salah","","","","TRUE","Teorema sudut segitiga datar.","",true',
    'essay,hard,"Pemodelan Matematika","uraian",5,manual_rubric,"Jelaskan langkah menyusun model fungsi kuadrat dari tiga titik koordinat.","","","","","","","Dinilai berdasarkan kelengkapan langkah eliminasi SPLTV.","Skor 0-5 sesuai rubrik: identifikasi variabel (1), persamaan (2), solusi (2).",false',
  ];
  return sampleRows.join("\r\n");
}

export async function generateXlsxImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Template Soal");
  sheet.addRow([...IMPORT_TEMPLATE_HEADERS]);
  sheet.addRow([
    "single_choice",
    "easy",
    "Persamaan Linear",
    "aljabar,kelas10",
    2,
    "exact_match",
    "Nilai x dari persamaan $2x + 4 = 10$ adalah...",
    "2",
    "3",
    "4",
    "5",
    "",
    "B",
    "2x = 6 sehingga x = 3",
    "",
    "false",
  ]);
  sheet.addRow([
    "multiple_choice",
    "medium",
    "Bilangan Prima",
    "aritmetika",
    3,
    "exact_match",
    "Manakah di antara bilangan berikut yang merupakan bilangan prima?",
    "2",
    "4",
    "5",
    "9",
    "",
    "A,C",
    "2 dan 5 hanya habis dibagi 1 dan dirinya sendiri",
    "",
    "false",
  ]);
  sheet.addRow([
    "true_false",
    "easy",
    "Geometri Dasar",
    "segitiga",
    1,
    "exact_match",
    "Jumlah sudut dalam segitiga datar selalu $180^\\circ$.",
    "Benar",
    "Salah",
    "",
    "",
    "",
    "TRUE",
    "Teorema sudut segitiga datar.",
    "",
    "true",
  ]);
  sheet.addRow([
    "essay",
    "hard",
    "Pemodelan Matematika",
    "uraian",
    5,
    "manual_rubric",
    "Jelaskan langkah menyusun model fungsi kuadrat dari tiga titik koordinat.",
    "",
    "",
    "",
    "",
    "",
    "",
    "Dinilai berdasarkan rubrik.",
    "Identifikasi (1), sistem persamaan (2), penyelesaian akhir (2).",
    "false",
  ]);
  sheet.getRow(1).font = { bold: true };
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
