import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAcademicYears } from "@/repositories/academic-repository";
import { requireRoleActor } from "@/services/auth-service";
import { getAuthorizedClassesForActor } from "@/services/exam-service";
import { getAuthorizedSubjectIdsForActor } from "@/services/question-bank-service";
import { PageHeader } from "@/components/layout/page-header";
import { ExamCreateForm } from "@/components/features/teacher/exam-create-form";

export const metadata: Metadata = {
  title: "Buat Ujian Baru",
};

export const dynamic = "force-dynamic";

export default async function TeacherCreateExamPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();

  const [authorizedSubjects, authorizedClasses, academicYears] = await Promise.all([
    getAuthorizedSubjectIdsForActor(supabase, actor),
    getAuthorizedClassesForActor(supabase, actor),
    fetchAcademicYears(supabase, actor.schoolId),
  ]);

  return (
    <div>
      <PageHeader
        title="Buat Ujian Baru"
        description="Konfigurasikan informasi dasar, durasi, acak soal, dan kelas peserta."
      />
      <ExamCreateForm
        authorizedSubjects={authorizedSubjects}
        authorizedClasses={authorizedClasses}
        academicYears={academicYears}
      />
    </div>
  );
}
