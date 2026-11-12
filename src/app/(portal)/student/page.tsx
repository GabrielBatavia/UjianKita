import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ClipboardList,
  History,
  PlayCircle,
  School,
  Smartphone,
} from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listStudentAvailableExamsService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { getStudentPortal } from "@/services/student-service";
import { PageHeader } from "@/components/layout/page-header";
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

export const metadata: Metadata = {
  title: "Beranda Siswa",
};

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const actor = await requireRoleActor("student");
  const supabase = await createSupabaseServerClient();
  const portal = await getStudentPortal(supabase, actor);

  let availableCount = 0;
  let activeAttemptExam: { examId: string; title: string; attemptId: string } | null = null;
  let completedCount = 0;

  if (portal.activeClass) {
    try {
      const catalog = await listStudentAvailableExamsService(supabase, actor);
      availableCount = catalog.items.filter((i) => i.canStart).length;
      completedCount = catalog.items.filter((i) => i.canViewReceipt).length;
      const inProgress = catalog.items.find((i) => i.canResume && i.activeAttemptId);
      if (inProgress && inProgress.activeAttemptId) {
        activeAttemptExam = {
          examId: inProgress.examId,
          title: inProgress.title,
          attemptId: inProgress.activeAttemptId,
        };
      }
    } catch {
      // Gracefully render academic card even when exam data cannot load
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Halo, ${actor.fullName}`}
        description={`${actor.schoolName} • Portal Siswa UjianKita`}
      />

      {activeAttemptExam ? (
        <Alert variant="warning" title="Anda Memiliki Sesi Ujian Berlangsung">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Sesi ujian <strong>{activeAttemptExam.title}</strong> masih aktif dan waktunya terus
              berjalan di server.
            </span>
            <Button asChild size="sm">
              <Link href={`/student/attempts/${activeAttemptExam.attemptId}`}>
                <PlayCircle className="h-4 w-4" aria-hidden="true" />
                <span>Lanjutkan Ujian Sekarang</span>
              </Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      {/* Student Active Class Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Informasi Akademik Aktif</CardTitle>
            <Badge variant={portal.activeClass ? "success" : "warning"}>
              {portal.activeClass ? "Terdaftar" : "Belum Ditempatkan"}
            </Badge>
          </div>
          <CardDescription>
            Nomor Induk Siswa (NIS):{" "}
            <span className="font-mono font-semibold text-slate-900">
              {portal.student?.nis ?? "-"}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {portal.activeClass ? (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-800">
                <School className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  Kelas {portal.activeClass.name} (Tingkat {portal.activeClass.grade_level})
                </p>
                <p className="text-xs text-slate-600">
                  Tahun Ajaran {portal.activeClass.academic_year_name} • Semester{" "}
                  {portal.activeClass.semester}
                </p>
              </div>
            </div>
          ) : (
            <Alert variant="warning" title="Belum Terdaftar di Kelas">
              Akun Anda belum ditempatkan pada kelas aktif. Hubungi administrator sekolah atau wali
              kelas Anda.
            </Alert>
          )}

          {portal.subjects.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mata Pelajaran Kelas ({portal.subjects.length})</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {portal.subjects.map((subj) => (
                  <Badge key={subj.id} variant="neutral">
                    {subj.name}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Quick Mobile-First Links */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <ClipboardList className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <Badge variant={availableCount > 0 ? "success" : "neutral"}>
                {availableCount} Tersedia
              </Badge>
            </div>
            <CardTitle className="mt-2">Daftar Ujian Kelas</CardTitle>
            <CardDescription>
              Lihat jadwal ujian, baca petunjuk pengerjaan, mulai atau lanjutkan sesi ujian resmi.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/student/exams">
                <span>Buka Daftar Ujian</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <History className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <Badge variant="neutral">{completedCount} Selesai</Badge>
            </div>
            <CardTitle className="mt-2">Hasil &amp; Bukti Pengumpulan</CardTitle>
            <CardDescription>
              Lihat bukti pengumpulan ujian resmi dan pantau nilai yang telah dirilis guru.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/student/results">
                <span>Lihat Hasil &amp; Bukti</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Browser Compatibility Note */}
      <Alert variant="info" title="Kesiapan Perangkat Ujian">
        <span className="inline-flex items-start gap-2">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Untuk ujian resmi sekolah, gunakan aplikasi peramban ujian yang direkomendasikan (
            <strong>ExamBro</strong> pada Android atau <strong>Safe Exam Browser</strong> pada
            iPhone/iPad/desktop) bila disyaratkan pada jadwal.
          </span>
        </span>
      </Alert>
    </div>
  );
}
