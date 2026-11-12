import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getStudentMonitoringTimelineService } from "@/services/monitoring-service";
import { PageHeader } from "@/components/layout/page-header";
import { StudentActivityTimelineView } from "@/components/features/monitoring/student-activity-timeline-view";

export const metadata: Metadata = {
  title: "Linimasa Siswa (Admin)",
};

export const dynamic = "force-dynamic";

export default async function AdminStudentMonitoringTimelinePage({
  params,
}: {
  params: Promise<{ examId: string; attemptId: string }>;
}) {
  const actor = await requirePermissionActor("monitoring.oversight");
  const { examId, attemptId } = await params;
  const supabase = await createSupabaseServerClient();

  let detail: Awaited<ReturnType<typeof getStudentMonitoringTimelineService>>;
  try {
    detail = await getStudentMonitoringTimelineService(
      supabase,
      actor,
      examId,
      attemptId
    );
  } catch (err) {
    if (isServiceError(err) && err.statusCode === 404) notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Linimasa: ${detail.student.studentName}`}
        description="Log sinyal sesi lengkap beserta sumber pembuktian teknis."
      />
      <StudentActivityTimelineView
        examId={examId}
        student={detail.student}
        timeline={detail.timeline}
        hiddenDurations={detail.hiddenDurations}
        incidents={detail.incidents}
        disclaimer={detail.disclaimer}
        timeZone={actor.timezone}
        basePath="/admin/monitoring"
      />
    </div>
  );
}
