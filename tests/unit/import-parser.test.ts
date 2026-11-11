import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generateCsvImportTemplate,
  generateXlsxImportTemplate,
  MAX_IMPORT_FILE_BYTES,
  parseQuestionImportFile,
} from "@/domain/exams/import-parser";

describe("Bulk Question Import parser (CSV & XLSX)", () => {
  it("parses the official CSV template cleanly with all 4 question types", async () => {
    const csv = generateCsvImportTemplate();
    const buffer = new TextEncoder().encode(csv).buffer;

    const result = await parseQuestionImportFile({
      fileName: "template.csv",
      buffer,
      existingFingerprints: new Set(),
    });

    expect(result.fileFormat).toBe("csv");
    expect(result.totalRows).toBe(4);
    expect(result.validRows).toHaveLength(4);
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("parses the official XLSX template cleanly", async () => {
    const xlsxBuf = await generateXlsxImportTemplate();
    const arrayBuffer = new Uint8Array(xlsxBuf).buffer;

    const result = await parseQuestionImportFile({
      fileName: "template.xlsx",
      buffer: arrayBuffer,
      existingFingerprints: new Set(),
    });

    expect(result.fileFormat).toBe("xlsx");
    expect(result.totalRows).toBe(4);
    expect(result.validRows).toHaveLength(4);
    expect(result.rejectedRows).toHaveLength(0);
  });

  it("rejects formula injection, invalid question types, and duplicate rows with row-level reasons", async () => {
    const csv = [
      "question_type,difficulty,topic,tags,points,scoring_policy,stem,option_a,option_b,option_c,option_d,option_e,correct_answers,explanation,rubric_notes,preserve_option_order",
      'single_choice,easy,Aljabar,a,2,exact_match,"Soal valid $x=1$","1","2","3","4","","A","","",false',
      'single_choice,easy,Aljabar,a,2,exact_match,"Soal valid $x=1$","1","2","3","4","","A","","",false',
      'single_choice,easy,Malicious,a,2,exact_match,"=CMD(\'calc\')","1","2","","","","A","","",false',
      'unknown_type,easy,Bad,a,2,exact_match,"Pertanyaan tipe salah","1","2","","","","A","","",false',
    ].join("\r\n");

    const result = await parseQuestionImportFile({
      fileName: "mixed.csv",
      buffer: new TextEncoder().encode(csv).buffer,
      existingFingerprints: new Set(),
    });

    expect(result.totalRows).toBe(4);
    expect(result.validRows).toHaveLength(1);
    expect(result.rejectedRows).toHaveLength(3);
    expect(result.duplicateCount).toBe(1);
    expect(result.rejectedRows.some((r) => r.reason.includes("formula"))).toBe(true);
    expect(result.rejectedRows.some((r) => r.reason.includes("Tipe soal tidak valid"))).toBe(true);
  });

  it("rejects Excel workbooks containing formula cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Soal");
    ws.addRow([
      "question_type",
      "difficulty",
      "topic",
      "tags",
      "points",
      "scoring_policy",
      "stem",
      "option_a",
      "option_b",
      "correct_answers",
    ]);
    ws.addRow([
      "single_choice",
      "easy",
      "Test",
      "",
      2,
      "exact_match",
      { formula: "1+1" },
      "2",
      "3",
      "A",
    ]);

    const rawBuf = new Uint8Array(await wb.xlsx.writeBuffer());
    const result = await parseQuestionImportFile({
      fileName: "formula.xlsx",
      buffer: rawBuf.buffer,
      existingFingerprints: new Set(),
    });

    expect(result.validRows).toHaveLength(0);
    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0]?.reason).toContain("formula");
  });

  it("rejects unsupported file extensions and oversized uploads", async () => {
    await expect(
      parseQuestionImportFile({
        fileName: "script.exe",
        buffer: new ArrayBuffer(10),
        existingFingerprints: new Set(),
      })
    ).rejects.toThrow();

    await expect(
      parseQuestionImportFile({
        fileName: "huge.csv",
        buffer: new ArrayBuffer(MAX_IMPORT_FILE_BYTES + 10),
        existingFingerprints: new Set(),
      })
    ).rejects.toThrow();
  });
});
