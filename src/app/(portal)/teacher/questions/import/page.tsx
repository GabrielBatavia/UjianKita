import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { getAuthorizedSubjectIdsForActor } from "@/services/question-bank-service";
import { PageHeader } from "@/components/layout/page-header";
import { QuestionImportWizard } from "@/components/features/teacher/question-import-wizard";

export const metadata: Metadata = {
  title: "Impor Soal Massal",
};

export const dynamic = "force-dynamic";

export default async function ImportQuestionsPage() {
  const actor = await requireAnyRoleActor(["teacher", "admin"]);
  const supabase = await createSupabaseServerClient();
  const authorizedSubjects = await getAuthorizedSubjectIdsForActor(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Impor Soal Massal (CSV &amp; XLSX)"
        description="Validasi pratinjau baris per baris, deteksi duplikasi otomatis, dan penyimpanan atomik ke bank soal."
      />
      <QuestionImportWizard authorizedSubjects={authorizedSubjects} />
    </div>
  );
}
