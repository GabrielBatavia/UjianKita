"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  FileText,
  Printer,
  ShieldCheck,
} from "lucide-react";
import type { StudentSubmissionReceiptDetail } from "@/domain/exams/phase3-types";
import { formatDateTimeId } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function StudentSubmissionReceiptView({
  receipt,
  timeZone,
}: {
  receipt: StudentSubmissionReceiptDetail;
  timeZone: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bukti Pengumpulan Ujian</h1>
          <p className="mt-1 text-sm text-slate-600">
            Catatan pengumpulan resmi yang tersimpan di server UjianKita.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          <span>Cetak Bukti</span>
        </Button>
      </div>

      <Card className="border-emerald-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-emerald-50/60">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-lg text-slate-900">{receipt.examTitle}</CardTitle>
                <CardDescription className="text-slate-700">
                  {receipt.subjectName} • Percobaan ke-{receipt.attemptNumber}
                </CardDescription>
              </div>
            </div>
            <Badge variant={receipt.attemptStatus === "EXPIRED" ? "warning" : "success"}>
              {receipt.attemptStatus === "EXPIRED" ? "Selesai (Waktu Habis)" : "Dikumpulkan"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-5 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-slate-500">Kode Bukti Resmi</p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900">{receipt.receiptCode}</p>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 p-3">
              <dt className="text-xs text-slate-500">Nama Peserta</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{receipt.studentName}</dd>
              <dd className="text-xs text-slate-600">
                {receipt.className} {receipt.studentNis ? `• NIS ${receipt.studentNis}` : ""}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <dt className="text-xs text-slate-500">Jawaban Tersimpan</dt>
              <dd className="mt-0.5 font-mono text-base font-bold text-slate-900">
                {receipt.answeredCount} dari {receipt.totalQuestions} soal
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <dt className="text-xs text-slate-500">Waktu Mulai</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {formatDateTimeId(receipt.startedAtUtc, timeZone)}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <dt className="text-xs text-slate-500">Waktu Selesai Resmi Server</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {formatDateTimeId(receipt.submittedAtUtc, timeZone)}
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <span>Sidik Integritas Pengumpulan (SHA-256)</span>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">
              {receipt.integrityDigest}
            </p>
          </div>

          {receipt.canViewResultNow ? (
            <Alert variant="success" title="Hasil Ujian Sudah Tersedia">
              Nilai untuk ujian ini sudah dirilis oleh guru dan dapat dilihat pada halaman Hasil
              Ujian.
            </Alert>
          ) : (
            <Alert variant="info" title="Status Penilaian">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {receipt.gradingStatus === "PENDING_MANUAL_REVIEW"
                    ? "Jawaban pilihan ganda telah dinilai, sedangkan soal esai menunggu pemeriksaan guru."
                    : "Hasil nilai belum dirilis sesuai kebijakan guru / jadwal ujian."}
                </span>
              </div>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button asChild variant="outline">
              <Link href="/student/exams">Kembali ke Daftar Ujian</Link>
            </Button>
            <Button asChild>
              <Link href="/student/results">
                <FileText className="h-4 w-4" aria-hidden="true" />
                <span>Buka Halaman Hasil</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
