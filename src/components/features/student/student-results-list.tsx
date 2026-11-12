"use client";

import * as React from "react";
import Link from "next/link";
import { Award, Clock, FileCheck2, Lock } from "lucide-react";
import type { StudentResultListItem } from "@/domain/exams/phase3-types";
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

export function StudentResultsList({
  results,
  timeZone,
}: {
  results: StudentResultListItem[];
  timeZone: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Riwayat &amp; Hasil Ujian</h1>
          <p className="mt-1 text-sm text-slate-600">
            Nilai hanya tampil setelah seluruh penilaian selesai dan dirilis oleh guru.
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/student/exams">Daftar Ujian</Link>
        </Button>
      </div>

      {results.length === 0 ? (
        <Alert variant="info" title="Belum ada riwayat pengumpulan">
          Anda belum mengumpulkan sesi ujian apa pun. Ujian yang sudah selesai akan muncul di sini
          berserta kode bukti resmi dan status nilai.
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {results.map((item) => (
            <Card key={item.attemptId} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {item.subjectName}
                    </p>
                    <CardTitle className="mt-1 text-lg text-slate-900">
                      {item.examTitle}
                    </CardTitle>
                    <CardDescription>
                      Percobaan ke-{item.attemptNumber} •{" "}
                      {item.submittedAtUtc
                        ? formatDateTimeId(item.submittedAtUtc, timeZone)
                        : "-"}
                    </CardDescription>
                  </div>
                  {item.resultsVisible ? (
                    <Badge variant={item.passed ? "success" : "warning"}>
                      {item.passed ? "Tuntas" : "Belum Tuntas"}
                    </Badge>
                  ) : item.attemptStatus === "CANCELLED_BY_ADMIN" ? (
                    <Badge variant="danger">Dibatalkan</Badge>
                  ) : (
                    <Badge variant="neutral">Menunggu Rilis</Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {item.resultsVisible && item.totalScore !== null && item.maxScore !== null ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">Nilai Akhir</p>
                        <p className="mt-0.5 font-mono text-2xl font-bold text-slate-900">
                          {item.percentageScore?.toFixed(2)}%
                        </p>
                        <p className="text-xs text-slate-600">
                          Skor: {item.totalScore} / {item.maxScore} (KKM {item.passingScore ?? 70})
                        </p>
                      </div>
                      <Award
                        className={`h-8 w-8 ${
                          item.passed ? "text-emerald-600" : "text-amber-600"
                        }`}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
                      <span>Objektif: {item.objectiveScore ?? 0}</span>
                      <span>Esai/Manual: {item.manualScore ?? 0}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-700">
                    {item.attemptStatus === "CANCELLED_BY_ADMIN" ? (
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                    ) : (
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    )}
                    <span>{item.withheldReason}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    Kode Bukti:{" "}
                    <strong className="font-mono text-slate-900">
                      {item.receiptCode ?? "Tidak tersedia"}
                    </strong>
                  </span>
                  {item.receiptCode ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/student/attempts/${item.attemptId}/receipt`}>
                        <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Lihat Bukti</span>
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
