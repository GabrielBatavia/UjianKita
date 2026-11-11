import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  GraduationCap,
  School,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { formatDateTimeId } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAdminOverview } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { UpcomingModuleCard } from "@/components/layout/upcoming-module-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Ringkasan Administrator",
};

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { stats, recentAudit, school } = await getAdminOverview(supabase, actor);

  const summaryCards = [
    {
      label: "Siswa Aktif",
      value: `${stats.activeStudents} / ${stats.totalStudents}`,
      icon: GraduationCap,
      href: "/admin/students",
    },
    {
      label: "Guru Aktif",
      value: `${stats.activeTeachers} / ${stats.totalTeachers}`,
      icon: UserCheck,
      href: "/admin/teachers",
    },
    {
      label: "Kelas Terdaftar",
      value: String(stats.totalClasses),
      icon: School,
      href: "/admin/classes",
    },
    {
      label: "Mata Pelajaran",
      value: String(stats.totalSubjects),
      icon: BookOpen,
      href: "/admin/subjects",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ringkasan Administrasi Sekolah"
        description={`Data langsung dari basis data ${actor.schoolName}. Seluruh metrik mencerminkan catatan aktual saat ini.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/settings">Pengaturan Sekolah</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.label} href={item.href} className="group">
              <Card className="h-full transition-colors group-hover:border-blue-300">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardDescription className="font-medium text-slate-600">
                    {item.label}
                  </CardDescription>
                  <Icon className="h-4 w-4 text-blue-700" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">{item.value}</div>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
                    <span>Kelola</span>
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Status Tahun Ajaran &amp; Kebijakan</CardTitle>
              <CalendarDays className="h-5 w-5 text-slate-400" aria-hidden="true" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div>
                <p className="text-xs font-medium text-slate-500">Tahun Ajaran Aktif</p>
                <p className="mt-0.5 font-semibold text-slate-900">
                  {stats.activeAcademicYear
                    ? `${stats.activeAcademicYear.name} — Semester ${stats.activeAcademicYear.semester}`
                    : "Belum ada tahun ajaran aktif"}
                </p>
              </div>
              <Badge variant={stats.activeAcademicYear ? "success" : "warning"}>
                {stats.activeAcademicYear ? "Aktif" : "Perlu Diatur"}
              </Badge>
            </div>

            {school ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Zona Waktu</span>
                  <span className="font-semibold text-slate-900">{school.timezone}</span>
                </div>
                <div className="flex justify-between">
                  <span>Kebijakan Rilis Nilai</span>
                  <span className="font-semibold text-slate-900">
                    {school.result_release_policy}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Wajib ExamBro / SEB (Ujian Resmi)</span>
                  <span className="font-semibold text-slate-900">
                    {school.exam_policy.require_exam_browser_in_high_stakes ? "Ya" : "Tidak"}
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <UpcomingModuleCard
          title="Modul Ujian & Pemantauan"
          phaseLabel="Fase 2 & Fase 3"
          description="Fitur inti pelaksanaan ujian belum diaktifkan pada Fase 1 dan sedang dipersiapkan di atas fondasi ini."
          plannedCapabilities={[
            "Persetujuan versi ujian yang tidak dapat diubah diam-diam setelah dimulai.",
            "Pemantauan sesi ujian langsung (~100 peserta serentak) tanpa menentukan pelanggaran otomatis dari satu sinyal.",
            "Ekspor hasil nilai resmi dan audit penyesuaian nilai.",
          ]}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Aktivitas Audit Terbaru</CardTitle>
            <CardDescription>
              Log append-only untuk perubahan data akademik dan aktivitas akun.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/settings">Lihat Semua</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentAudit.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="Belum Ada Catatan Audit"
              description="Aktivitas seperti penambahan siswa, pembaruan kelas, atau perubahan pengaturan akan tampil di sini."
            />
          ) : (
            <div className="divide-y divide-slate-200">
              {recentAudit.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{event.summary}</p>
                    <p className="text-xs text-slate-500">
                      {event.actor_name ?? "Sistem"} •{" "}
                      <span className="font-mono text-blue-700">{event.action}</span>
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDateTimeId(event.created_at, actor.timezone)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
