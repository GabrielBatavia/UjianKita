import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { getAdminMonitoringOverviewService } from "@/services/monitoring-service";
import { PageHeader } from "@/components/layout/page-header";
import { AdminMonitoringOversightClient } from "@/components/features/monitoring/admin-monitoring-oversight-client";

export const metadata: Metadata = {
  title: "Pusat Keamanan & Pengawasan Sekolah",
};

export const dynamic = "force-dynamic";

export default async function AdminMonitoringPage() {
  const actor = await requirePermissionActor("monitoring.oversight");
  const supabase = await createSupabaseServerClient();
  const data = await getAdminMonitoringOverviewService(supabase, actor);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pusat Keamanan &amp; Pengawasan Ujian"
        description="Pengawasan kondisi ujian aktif lintas mata pelajaran, audit pengecualian peramban, dan kebijakan retensi data."
      />
      <AdminMonitoringOversightClient initialData={data} timeZone={actor.timezone} />
    </div>
  );
}
