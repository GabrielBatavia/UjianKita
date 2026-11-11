import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAcademicYears } from "@/repositories/academic-repository";
import { fetchPaginatedQuestions } from "@/repositories/question-bank-repository";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getExamDetailService } from "@/services/exam-service";
import { PageHeader } from "@/components/layout/page-header";
import { ExamWorkspace } from "@/components/features/teacher/exam-workspace";

export const metadata: Metadata = {
  title: "Kelola Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherExamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRoleActor("teacher");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  let detail: Awaited<ReturnType<typeof getExamDetailService>>;
  let bankRes: Awaited<ReturnType<typeof fetchPaginatedQuestions>>;
  let academicYears: Awaited<ReturnType<typeof fetchAcademicYears>>;
  try {
    detail = await getExamDetailService(supabase, actor, id);
    [bankRes, academicYears] = await Promise.all([
      fetchPaginatedQuestions(supabase, {
        schoolId: actor.schoolId,
        subjectId: detail.exam.subject_id,
        status: "all_non_archived",
        page: 1,
        pageSize: 100,
      }),
      fetchAcademicYears(supabase, actor.schoolId),
    ]);
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
        description={`${detail.exam.subject_code ?? ""} — ${detail.exam.subject_name ?? ""} • Pengaturan, Soal, Jadwal & Publikasi`}
      />
      <ExamWorkspace
        initialExam={detail.exam}
        initialDraftQuestions={detail.draftQuestions}
        initialAssignments={detail.assignments}
        initialSchedules={detail.schedules}
        initialPublishedVersions={detail.publishedVersions}
        initialPublicationEvents={detail.publicationEvents}
        initialReadiness={detail.readiness}
        initialConflicts={detail.conflicts}
        availableBankQuestions={bankRes.questions}
        authorizedClasses={detail.authorizedClasses}
        academicYears={academicYears}
        timeZone={actor.timezone}
      />
    </div>
  );
}
