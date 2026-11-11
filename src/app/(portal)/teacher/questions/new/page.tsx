import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getAuthorizedSubjectIdsForActor } from "@/services/question-bank-service";
import { PageHeader } from "@/components/layout/page-header";
import { QuestionEditor } from "@/components/features/teacher/question-editor";

export const metadata: Metadata = {
  title: "Buat Soal Baru",
};

export const dynamic = "force-dynamic";

export default async function NewQuestionPage() {
  const actor = await requireAnyRoleActor(["teacher", "admin"]);
  const supabase = await createSupabaseServerClient();
  const authorizedSubjects = await getAuthorizedSubjectIdsForActor(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Buat Soal Baru"
        description="Tambahkan soal Pilihan Ganda, Pilihan Jamak, Benar/Salah, atau Esai dengan rumus matematika LaTeX."
      />
      <QuestionEditor mode="create" authorizedSubjects={authorizedSubjects} />
    </div>
  );
}
