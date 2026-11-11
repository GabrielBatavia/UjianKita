import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import {
  getAuthorizedSubjectIdsForActor,
  getQuestionDetailService,
} from "@/services/question-bank-service";
import { isServiceError } from "@/services/errors";
import { PageHeader } from "@/components/layout/page-header";
import { QuestionEditor } from "@/components/features/teacher/question-editor";

export const metadata: Metadata = {
  title: "Edit Soal & Riwayat Revisi",
};

export const dynamic = "force-dynamic";

export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAnyRoleActor(["teacher", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  let detail: Awaited<ReturnType<typeof getQuestionDetailService>>;
  let authorizedSubjects: Awaited<ReturnType<typeof getAuthorizedSubjectIdsForActor>>;
  try {
    [detail, authorizedSubjects] = await Promise.all([
      getQuestionDetailService(supabase, actor, id),
      getAuthorizedSubjectIdsForActor(supabase, actor),
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
        title="Edit Soal &amp; Riwayat Versi"
        description="Menyimpan perubahan akan membuat versi baru tanpa mengubah naskah ujian yang sudah diterbitkan."
      />
      <QuestionEditor
        mode="edit"
        authorizedSubjects={authorizedSubjects}
        initialQuestion={detail.question}
        versionHistory={detail.versions}
      />
    </div>
  );
}
