import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { listTeacherMonitoredExamsService } from "@/services/monitoring-service";
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
  title: "Pemantauan Ujian Langsung",
};

export const dynamic = "force-dynamic";

export default async function TeacherMonitoringOverviewPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();
  const exams = await listTeacherMonitoredExamsService(supabase, actor);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pemantauan Ujian Langsung"
        description="Supervisi koneksi peserta, kebijakan Safe Exam Browser / ExamBro, serta tinjauan insiden secara adil."
      />

      {exams.length === 0 ? (
        <Alert variant="info" title="Belum ada ujian aktif atau selesai">
          Pusat pemantauan menampilkan ujian berstatus Terbit atau Ditutup di sekolah Anda.
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {exams.map((exam) => (
            <Card key={exam.examId} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {exam.subjectName}
                    </p>
                    <CardTitle className="mt-1 text-lg">{exam.title}</CardTitle>
                    <CardDescription>
                      Kebijakan: <strong>{exam.browserPolicy}</strong>
                    </CardDescription>
                  </div>
                  <Badge variant={exam.openIncidents > 0 ? "danger" : "success"}>
                    {exam.openIncidents > 0
                      ? `${exam.openIncidents} Insiden Terbuka`
                      : "Stabil"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-center text-xs">
                  <div>
                    <p className="text-slate-500">Sedang Mengerjakan</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
                      {exam.activeStudents}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Koneksi Tertunda</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-amber-700">
                      {exam.staleConnections}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Terkumpul</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-emerald-700">
                      {exam.submittedCount}/{exam.totalAssigned}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild className="flex-1">
                    <Link href={`/teacher/monitoring/${exam.examId}`}>
                      <Activity className="h-4 w-4" aria-hidden="true" />
                      <span>Buka Pusat Kontrol</span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/teacher/monitoring/${exam.examId}/incidents`}>
                      {exam.openIncidents > 0 ? (
                        <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>Insiden ({exam.openIncidents})</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
