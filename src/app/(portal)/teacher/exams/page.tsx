import type { Metadata } from "next";
import type { ExamStatus } from "@/domain/exams/phase2-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { listExamsService } from "@/services/exam-service";
import { PageHeader } from "@/components/layout/page-header";
import { ExamsList } from "@/components/features/teacher/exams-list";

export const metadata: Metadata = {
  title: "Manajemen Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectId?: string; status?: string; search?: string }>;
}) {
  const actor = await requireRoleActor("teacher");
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const data = await listExamsService(supabase, actor, {
    subjectId: sp.subjectId || undefined,
    status: (sp.status as ExamStatus | undefined) || undefined,
    search: sp.search || undefined,
    page: 1,
    pageSize: 30,
  });

  return (
    <div>
      <PageHeader
        title="Manajemen Ujian"
        description="Buat draf ujian, susun soal dari bank soal, atur jadwal, tinjau pratinjau siswa, lalu terbitkan versi imutabel."
      />
      <ExamsList
        initialExams={data.exams}
        authorizedSubjects={data.authorizedSubjects}
        initialFilters={sp}
        timeZone={actor.timezone}
      />
    </div>
  );
}
