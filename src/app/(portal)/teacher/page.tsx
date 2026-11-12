import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ClipboardList, Database, School } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { listExamsService } from "@/services/exam-service";
import { listQuestionsService } from "@/services/question-bank-service";
import { getTeacherWorkspace } from "@/services/teacher-service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Ruang Kerja Guru",
};

export const dynamic = "force-dynamic";

export default async function TeacherOverviewPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();

  const [data, questionsSummary, examsSummary] = await Promise.all([
    getTeacherWorkspace(supabase, actor),
    listQuestionsService(supabase, actor, { page: 1, pageSize: 5 }),
    listExamsService(supabase, actor, { page: 1, pageSize: 5 }),
  ]);

  const totalAssignedStudents = data.assignedClasses.reduce(
    (sum, cls) => sum + cls.student_count,
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Selamat Datang, ${actor.fullName}`}
        description={`Ruang kerja guru untuk ${actor.schoolName}. Kelola bank soal, penyusunan ujian, jadwal, dan kelas yang diampu.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/questions/new">Buat Soal</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/teacher/exams/new">Buat Ujian</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/teacher/classes" className="group">
          <Card className="h-full transition-colors group-hover:border-blue-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Kelas Diampu</CardDescription>
              <School className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{data.assignedClasses.length}</div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                <span>{totalAssignedStudents} siswa aktif</span>
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

        <Link href="/teacher/questions" className="group">
          <Card className="h-full transition-colors group-hover:border-blue-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Bank Soal</CardDescription>
              <Database className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{questionsSummary.total}</div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                <span>Kelola bank soal</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/teacher/exams" className="group">
          <Card className="h-full transition-colors group-hover:border-blue-300">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>Paket Ujian</CardDescription>
              <ClipboardList className="h-4 w-4 text-blue-700" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{examsSummary.total}</div>
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                <span>Kelola ujian</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </CardContent>
          </Card>
        </Link>
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

        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Pelaksanaan, Pemantauan &amp; Penilaian</CardTitle>
              <Badge variant="success">Aktif</Badge>
            </div>
            <CardDescription>
              Seluruh modul pengajaran—bank soal terversi, snapshot ujian, pengawasan langsung,
              dan koreksi nilai—siap digunakan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span>Mesin pengerjaan ujian siswa dengan autosave idempoten dan pengatur waktu server.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span>Dasbor pengawasan langsung (heartbeat, status koneksi, &amp; pengecualian peramban teraudit).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span>Koreksi otomatis objektif, penilaian rubrik esai, dan rilis nilai resmi.</span>
              </li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm">
                <Link href="/teacher/monitoring">Pengawasan Ujian</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/teacher/grading">Koreksi &amp; Nilai</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
