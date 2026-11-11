import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, School } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getTeacherWorkspace } from "@/services/teacher-service";
import { PageHeader } from "@/components/layout/page-header";
import { UpcomingModuleCard } from "@/components/layout/upcoming-module-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Ruang Kerja Guru",
};

export const dynamic = "force-dynamic";

export default async function TeacherOverviewPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();
  const data = await getTeacherWorkspace(supabase, actor);

  const totalAssignedStudents = data.assignedClasses.reduce(
    (sum, cls) => sum + cls.student_count,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Selamat Datang, ${actor.fullName}`}
        description={`Ruang kerja guru untuk ${actor.schoolName}. Menampilkan kelas dan mata pelajaran yang ditugaskan kepada Anda.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/teacher/classes" className="group">
          <Card className="h-full transition-colors group-hover:border-blue-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Kelas Diampu</CardDescription>
              <School className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{data.assignedClasses.length}</div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                <span>Lihat kelas</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/teacher/subjects" className="group">
          <Card className="h-full transition-colors group-hover:border-blue-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Mata Pelajaran</CardDescription>
              <BookOpen className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {data.assignedSubjects.length}
              </div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                <span>Lihat mata pelajaran</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Siswa di Kelas Diampu</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalAssignedStudents}</div>
            <p className="mt-1 text-xs text-slate-500">Berdasarkan pendaftaran kelas aktif</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profil Pengajar</CardTitle>
            <CardDescription>Data kepegawaian yang tercatat di sekolah</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">NIP</span>
              <span className="font-mono font-medium text-slate-900">
                {data.teacher?.nip ?? "Belum diisi"}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">Bidang Studi</span>
              <span className="font-medium text-slate-900">
                {data.teacher?.specialization ?? "Belum diisi"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Status</span>
              <Badge variant={data.teacher?.is_active ? "success" : "neutral"}>
                {data.teacher?.employment_status ?? "-"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <UpcomingModuleCard
          title="Bank Soal, Perakitan Ujian & Penilaian"
          phaseLabel="Segera Hadir — Fase 2"
          description="Modul pembuatan soal, penjadwalan ujian, pemantauan sesi, dan penilaian akan dibuka pada Fase 2."
          plannedCapabilities={[
            "Pembuatan soal dengan riwayat versi, media, rumus matematika, dan pemisahan kunci jawaban.",
            "Perakitan paket ujian dengan jadwal, batas waktu otoritatif server, dan versi terpublikasi yang terkunci.",
            "Pemantauan pelaksanaan ujian dan penilaian esai teraudit.",
          ]}
        />
      </div>
    </div>
  );
}
