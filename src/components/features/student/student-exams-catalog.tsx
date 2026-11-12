"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileCheck2,
  Lock,
  PlayCircle,
  ShieldAlert,
} from "lucide-react";
import type {
  StudentExamAvailabilityItem,
  StudentExamCategory,
} from "@/domain/exams/phase3-types";
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

const CATEGORY_META: Record<
  StudentExamCategory,
  { label: string; badgeVariant: "success" | "default" | "warning" | "neutral" | "danger" }
> = {
  sedang_berlangsung: { label: "Sedang Berlangsung", badgeVariant: "warning" },
  tersedia: { label: "Tersedia Sekarang", badgeVariant: "success" },
  akan_datang: { label: "Akan Datang", badgeVariant: "default" },
  selesai: { label: "Selesai", badgeVariant: "neutral" },
  kedaluwarsa: { label: "Kedaluwarsa", badgeVariant: "danger" },
  tidak_tersedia: { label: "Tidak Tersedia", badgeVariant: "neutral" },
};

const ORDER: StudentExamCategory[] = [
  "sedang_berlangsung",
  "tersedia",
  "akan_datang",
  "selesai",
  "kedaluwarsa",
  "tidak_tersedia",
];

export function StudentExamsCatalog({
  className,
  studentNis,
  items,
  timeZone,
}: {
  className: string;
  studentNis: string | null;
  items: StudentExamAvailabilityItem[];
  timeZone: string;
}) {
  const [filter, setFilter] = React.useState<"all" | StudentExamCategory>("all");

  const filtered = React.useMemo(() => {
    const list = filter === "all" ? items : items.filter((item) => item.category === filter);
    return [...list].sort(
      (a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)
    );
  }, [items, filter]);

  const counts = React.useMemo(() => {
    const map = new Map<StudentExamCategory, number>();
    for (const c of ORDER) map.set(c, 0);
    for (const item of items) {
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Daftar Ujian Kelas</h1>
          <p className="mt-1 text-sm text-slate-600">
            Kelas aktif: <strong>{className}</strong>
            {studentNis ? ` • NIS ${studentNis}` : ""}
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/student/results">
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            <span>Lihat Hasil &amp; Bukti</span>
          </Link>
        </Button>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter status ujian">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`min-h-[38px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            filter === "all"
              ? "border-blue-700 bg-blue-700 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Semua ({items.length})
        </button>
        {ORDER.map((cat) => {
          const count = counts.get(cat) ?? 0;
          if (count === 0 && cat !== "tersedia" && cat !== "selesai") return null;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setFilter(cat)}
              className={`min-h-[38px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filter === cat
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {CATEGORY_META[cat].label} ({count})
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <Alert variant="info" title="Belum ada jadwal ujian">
          Saat ini belum ada ujian terbit yang dijadwalkan untuk kelas {className}. Periksa kembali
          menjelang jadwal ujian dimulai.
        </Alert>
      ) : filtered.length === 0 ? (
        <Alert variant="info">
          Tidak ada ujian pada kategori ini. Pilih filter <strong>Semua</strong> untuk melihat daftar
          lengkap.
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((item) => {
            const meta = CATEGORY_META[item.category];
            return (
              <Card key={item.examId} className="flex flex-col justify-between border-slate-200">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                        {item.subjectCode} • {item.subjectName}
                      </p>
                      <CardTitle className="mt-1 text-lg text-slate-900">{item.title}</CardTitle>
                    </div>
                    <Badge variant={meta.badgeVariant} className="shrink-0">
                      {meta.label}
                    </Badge>
                  </div>
                  <CardDescription className="mt-1 text-slate-600">
                    {item.statusMessage}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                      <span>
                        Durasi: <strong>{item.durationMinutes} menit</strong>
                      </span>
                    </div>
                    <div>
                      Soal: <strong>{item.questionCount} butir</strong> ({item.totalPoints} poin)
                    </div>
                    <div className="col-span-2 flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                      <span className="truncate">
                        {item.startsAt
                          ? `${formatDateTimeId(item.startsAt, timeZone)} — ${
                              item.endsAt ? formatDateTimeId(item.endsAt, timeZone) : "-"
                            }`
                          : "Jadwal belum ditentukan"}
                      </span>
                    </div>
                    <div>
                      Percobaan:{" "}
                      <strong>
                        {item.attemptsUsed} / {item.maxAttempts}
                      </strong>
                    </div>
                    <div>
                      KKM: <strong>{item.passingScore}</strong>
                    </div>
                  </div>

                  {item.requireExamBrowser ? (
                    <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs text-blue-900">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Mode perangkat ujian (ExamBro / SEB) direkomendasikan sekolah untuk sesi ini.
                      </span>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {item.canResume && item.activeAttemptId ? (
                      <Button asChild className="w-full sm:w-auto">
                        <Link href={`/student/attempts/${item.activeAttemptId}`}>
                          <PlayCircle className="h-4 w-4" aria-hidden="true" />
                          <span>Lanjutkan Ujian</span>
                        </Link>
                      </Button>
                    ) : item.canStart ? (
                      <Button asChild className="w-full sm:w-auto">
                        <Link href={`/student/exams/${item.examId}/instructions`}>
                          <span>Persiapan &amp; Mulai</span>
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/student/exams/${item.examId}`}>
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Detail Ujian</span>
                        </Link>
                      </Button>
                    )}

                    {item.canViewReceipt && item.latestAttemptId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/student/attempts/${item.latestAttemptId}/receipt`}>
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Bukti Kumpul</span>
                        </Link>
                      </Button>
                    ) : null}

                    {item.canViewResult ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link href="/student/results">
                          <span>Lihat Nilai</span>
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
