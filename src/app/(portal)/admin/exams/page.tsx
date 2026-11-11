import type { Metadata } from "next";
import type { ExamStatus } from "@/domain/exams/phase2-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { listExamsService } from "@/services/exam-service";
import { PageHeader } from "@/components/layout/page-header";
import { AdminExamsOversight } from "@/components/features/admin/admin-exams-oversight";

export const metadata: Metadata = {
  title: "Pengawasan Ujian Sekolah",
};

export const dynamic = "force-dynamic";

export default async function AdminExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectId?: string; status?: string; classId?: string; search?: string }>;
}) {
  const actor = await requireRoleActor("admin");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const data = await listExamsService(supabase, actor, {
    subjectId: sp.subjectId || undefined,
    status: (sp.status as ExamStatus | undefined) || undefined,
    classId: sp.classId || undefined,
    search: sp.search || undefined,
    page: 1,
    pageSize: 40,
  });

  return (
    <div>
      <PageHeader
        title="Pengawasan Ujian Sekolah"
        description="Pantau seluruh draf, ujian terpublikasi, kepemilikan guru, kelas peserta, dan riwayat versi di sekolah Anda."
      />
      <AdminExamsOversight
        initialExams={data.exams}
        subjects={data.authorizedSubjects}
        classes={data.authorizedClasses}
        initialFilters={sp}
        timeZone={actor.timezone}
      />
    </div>
  );
}
