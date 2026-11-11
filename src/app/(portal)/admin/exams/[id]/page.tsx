import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getExamDetailService } from "@/services/exam-service";
import { PageHeader } from "@/components/layout/page-header";
import { AdminExamDetail } from "@/components/features/admin/admin-exam-detail";

export const metadata: Metadata = {
  title: "Detail Pengawasan Ujian",
};

export const dynamic = "force-dynamic";

export default async function AdminExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRoleActor("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  let detail: Awaited<ReturnType<typeof getExamDetailService>>;
  try {
    detail = await getExamDetailService(supabase, actor, id);
  } catch (err) {
    if (isServiceError(err) && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div>
      <PageHeader
        title={detail.exam.title}
        description="Inspeksi konfigurasi, riwayat publikasi imutabel, dan tindakan pengawasan administratif."
      />
      <AdminExamDetail
        exam={detail.exam}
        assignments={detail.assignments}
        publishedVersions={detail.publishedVersions}
        publicationEvents={detail.publicationEvents}
        timeZone={actor.timezone}
      />
    </div>
  );
}
