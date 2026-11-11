import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, History, School, Smartphone } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getStudentPortal } from "@/services/student-service";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Beranda Siswa",
};

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const actor = await requireRoleActor("student");
  const supabase = await createSupabaseServerClient();
  const portal = await getStudentPortal(supabase, actor);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Halo, ${actor.fullName}`}
        description={`${actor.schoolName} • Portal Siswa UjianKita`}
      />

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

      {/* Quick Mobile-First Links to Upcoming Sections */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <ClipboardList className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <Badge variant="warning">Fase 2</Badge>
            </div>
            <CardTitle className="mt-2">Jadwal Ujian Mendatang</CardTitle>
            <CardDescription>
              Daftar ujian yang dijadwalkan untuk kelas Anda akan tampil di sini pada Fase 2.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/student/exams">
                <span>Lihat Detail Jadwal Ujian</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <History className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <Badge variant="warning">Fase 2</Badge>
            </div>
            <CardTitle className="mt-2">Riwayat &amp; Bukti Ujian</CardTitle>
            <CardDescription>
              Bukti pengumpulan resmi dan nilai yang telah dirilis guru akan tersedia di sini pada
              Fase 2.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/student/history">
                <span>Lihat Riwayat Ujian</span>
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
            Untuk ujian resmi pada fase berikutnya, sekolah akan menetapkan penggunaan aplikasi
            peramban ujian yang disetujui (<strong>ExamBro</strong> pada Android atau{" "}
            <strong>Safe Exam Browser</strong> pada iPhone/iPad).
          </span>
        </span>
      </Alert>
    </div>
  );
}
