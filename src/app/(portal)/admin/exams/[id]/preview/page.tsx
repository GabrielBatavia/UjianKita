import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { StudentExamPreviewPayload } from "@/domain/exams/phase2-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getExamPreviewService } from "@/services/exam-service";
import { PageHeader } from "@/components/layout/page-header";
import { ExamPreviewClient } from "@/components/features/teacher/exam-preview-client";

export const metadata: Metadata = {
  title: "Pratinjau Ujian (Pengawasan Admin)",
};

export const dynamic = "force-dynamic";

export default async function AdminExamPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRoleActor("admin");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  let payload: StudentExamPreviewPayload;
  try {
    payload = (await getExamPreviewService(
      supabase,
      actor,
      id,
      "student",
      false
    )) as StudentExamPreviewPayload;
  } catch (err) {
    if (isServiceError(err) && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div>
      <PageHeader
        title="Pratinjau Tampilan Ujian"
        description="Simulasi tampilan soal siswa dan tinjauan pengawasan administrator."
      />
      <ExamPreviewClient
        examId={id}
        initialStudentPayload={payload}
        backHref={`/admin/exams/${id}`}
      />
    </div>
  );
}
