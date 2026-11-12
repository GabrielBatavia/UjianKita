import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardCheck, Clock } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getTeacherGradingOverviewService } from "@/services/grading-service";
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
  title: "Penilaian & Hasil Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherGradingOverviewPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();
  const exams = await getTeacherGradingOverviewService(supabase, actor);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Penilaian & Rilis Hasil Ujian"
        description="Periksa jawaban esai, koreksi nilai teraudit, dan kendalikan rilis hasil kepada siswa."
      />

      {exams.length === 0 ? (
        <Alert variant="info" title="Belum ada ujian aktif atau selesai">
          Penilaian peserta tersedia untuk ujian yang berstatus Terbit atau Ditutup pada mata
          pelajaran yang Anda ampu.
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {exams.map((item) => (
            <Card key={item.examId} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {item.subjectCode} • {item.subjectName}
                    </p>
                    <CardTitle className="mt-1 text-lg">{item.title}</CardTitle>
                    <CardDescription>
                      Kebijakan rilis: <strong>{item.resultReleasePolicy}</strong>
                    </CardDescription>
                  </div>
                  <Badge variant={item.pendingEssayAttemptsCount > 0 ? "warning" : "success"}>
                    {item.pendingEssayAttemptsCount > 0
                      ? `${item.pendingEssayAttemptsCount} Perlu Esai`
                      : "Siap Rilis"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-center text-xs">
                  <div>
                    <p className="text-slate-500">Total Sesi</p>
                    <p className="mt-0.5 font-mono text-base font-bold text-slate-900">
                      {item.totalAttempts}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Terkumpul</p>
                    <p className="mt-0.5 flex items-center justify-center gap-1 font-mono text-base font-bold text-slate-900">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      <span>{item.submittedCount}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Nilai Dirilis</p>
                    <p className="mt-0.5 flex items-center justify-center gap-1 font-mono text-base font-bold text-slate-900">
                      {item.releasedCount > 0 ? (
                        <ClipboardCheck className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      )}
                      <span>{item.releasedCount}</span>
                    </p>
                  </div>
                </div>

                <Button asChild className="w-full justify-between">
                  <Link href={`/teacher/exams/${item.examId}/grading`}>
                    <span>Buka Ruang Penilaian</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
