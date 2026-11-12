import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getTeacherExamControlCenterService } from "@/services/monitoring-service";
import { PageHeader } from "@/components/layout/page-header";
import { TeacherExamControlCenter } from "@/components/features/monitoring/teacher-exam-control-center";

export const metadata: Metadata = {
  title: "Pusat Kontrol Pemantauan Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherExamControlCenterPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const actor = await requirePermissionActor("monitoring.read");
  const { examId } = await params;
  const supabase = await createSupabaseServerClient();

  let data: Awaited<ReturnType<typeof getTeacherExamControlCenterService>>;
  try {
    data = await getTeacherExamControlCenterService(supabase, actor, examId, {
      page: 1,
      pageSize: 100,
    });
  } catch (err) {
    if (isServiceError(err) && err.statusCode === 404) notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Pusat Kontrol: ${data.exam.title}`}
        description={`${data.exam.subjectName} • Pemantauan Koneksi, Peramban Aman & Antrean Tinjauan`}
      />
      <TeacherExamControlCenter initialData={data} timeZone={actor.timezone} />
    </div>
  );
}
