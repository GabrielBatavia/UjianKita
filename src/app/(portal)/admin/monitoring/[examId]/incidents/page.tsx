import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { listExamIncidentsService } from "@/services/monitoring-service";
import { PageHeader } from "@/components/layout/page-header";
import { IncidentReviewWorkspace } from "@/components/features/monitoring/incident-review-workspace";

export const metadata: Metadata = {
  title: "Tinjauan Insiden (Admin)",
};

export const dynamic = "force-dynamic";

export default async function AdminExamIncidentsPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const actor = await requirePermissionActor("monitoring.oversight");
  const { examId } = await params;
  const supabase = await createSupabaseServerClient();

  let incidents: Awaited<ReturnType<typeof listExamIncidentsService>>;
  try {
    incidents = await listExamIncidentsService(supabase, actor, examId);
  } catch (err) {
    if (isServiceError(err) && err.statusCode === 404) notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tinjauan Insiden Keamanan Ujian"
        description="Supervisi administrator terhadap kejadian teknis dan tinjauan pengawas."
      />
      <IncidentReviewWorkspace
        examId={examId}
        initialIncidents={incidents}
        timeZone={actor.timezone}
        basePath="/admin/monitoring"
      />
    </div>
  );
}
