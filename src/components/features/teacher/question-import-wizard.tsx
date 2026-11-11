"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import type { ImportParseResult } from "@/domain/exams/import-parser";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function QuestionImportWizard({
  authorizedSubjects,
}: {
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [subjectId, setSubjectId] = React.useState(authorizedSubjects[0]?.id ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [allowSkipRejected, setAllowSkipRejected] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportParseResult | null>(null);
  const [commitResult, setCommitResult] = React.useState<{
    importedCount: number;
    rejectedCount: number;
    duplicateCount: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function downloadTemplate(format: "csv" | "xlsx") {
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/teacher/questions/import/template?format=${format}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(body.error ?? "Gagal mengunduh templat impor.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        format === "xlsx"
          ? "template-impor-soal-ujiankita.xlsx"
          : "template-impor-soal-ujiankita.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Terjadi kesalahan jaringan saat mengunduh templat.");
    }
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !subjectId) return;
    setErrorMessage(null);
    setCommitResult(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("subjectId", subjectId);
      formData.append("file", file);

      const res = await fetch("/api/teacher/questions/import/preview", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as ImportParseResult & { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal memvalidasi berkas.");
        setPreview(null);
        return;
      }
      setPreview(data);
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCommitImport() {
    if (!file || !subjectId) return;
    setErrorMessage(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("subjectId", subjectId);
      formData.append("file", file);
      formData.append("allowSkipRejected", String(allowSkipRejected));

      const res = await fetch("/api/teacher/questions/import", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        importedCount?: number;
        rejectedCount?: number;
        duplicateCount?: number;
      };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal mengimpor soal.");
        return;
      }

      setCommitResult({
        importedCount: data.importedCount ?? 0,
        rejectedCount: data.rejectedCount ?? 0,
        duplicateCount: data.duplicateCount ?? 0,
      });
      setPreview(null);
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/teacher/questions">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Bank Soal</span>
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Unduh Templat Impor Resmi</CardTitle>
          <CardDescription>
            Gunakan struktur kolom resmi agar tipe soal, opsi, kunci jawaban, dan poin divalidasi
            secara akurat. Batas maksimal: 2 MB atau 500 soal per unggahan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadTemplate("csv")}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Unduh Templat CSV</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void downloadTemplate("xlsx")}
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            <span>Unduh Templat Excel (.xlsx)</span>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Unggah &amp; Pratinjau Berkas</CardTitle>
          <CardDescription>
            Semua baris divalidasi terlebih dahulu. Formula spreadsheet dan baris cacat akan ditolak
            tanpa menyimpan parsial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePreview} className="space-y-4">
            {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}
            {commitResult ? (
              <Alert variant="success" title="Impor Massal Selesai">
                Berhasil mengimpor <strong>{commitResult.importedCount}</strong> soal secara atomik.
                Ditolak/duplikat: {commitResult.rejectedCount} baris.
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="imp-subject">Mata Pelajaran Tujuan</Label>
                <Select
                  id="imp-subject"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
                >
                  {authorizedSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="imp-file">Berkas CSV / XLSX</Label>
                <Input
                  id="imp-file"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={loading || !file || !subjectId}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Pratinjau &amp; Validasi</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>3. Hasil Validasi ({preview.totalRows} Baris)</CardTitle>
                <CardDescription>
                  Valid: {preview.validRows.length} • Ditolak/Duplikat: {preview.rejectedRows.length}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant="success">{preview.validRows.length} Siap Impor</Badge>
                {preview.rejectedRows.length > 0 ? (
                  <Badge variant="danger">{preview.rejectedRows.length} Ditolak</Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {preview.rejectedRows.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-red-800">
                  Laporan Baris Bermasalah / Duplikat
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Baris</TableHead>
                      <TableHead>Pertanyaan</TableHead>
                      <TableHead>Alasan Penolakan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rejectedRows.map((row) => (
                      <TableRow key={`${row.rowNumber}-${row.reason}`}>
                        <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs">{row.rawStem || "-"}</TableCell>
                        <TableCell className="text-xs text-red-700">{row.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center gap-2">
                  <input
                    id="imp-skip"
                    type="checkbox"
                    checked={allowSkipRejected}
                    onChange={(e) => setAllowSkipRejected(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  <Label htmlFor="imp-skip">
                    Lewati baris bermasalah/duplikat dan impor hanya {preview.validRows.length} baris
                    yang valid
                  </Label>
                </div>
              </div>
            ) : null}

            {preview.validRows.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Pratinjau Soal Valid (Maks. 10 Pertama)
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Baris</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Pertanyaan</TableHead>
                      <TableHead>Poin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.validRows.slice(0, 10).map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                        <TableCell className="text-xs">{row.questionType}</TableCell>
                        <TableCell className="max-w-md truncate text-xs">{row.stem}</TableCell>
                        <TableCell className="font-mono text-xs">{row.points}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                size="lg"
                disabled={
                  loading ||
                  preview.validRows.length === 0 ||
                  (preview.rejectedRows.length > 0 && !allowSkipRejected)
                }
                onClick={handleCommitImport}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                <span>Impor {preview.validRows.length} Soal ke Bank Soal</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
