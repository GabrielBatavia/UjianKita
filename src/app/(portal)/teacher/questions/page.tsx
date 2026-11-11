import type { Metadata } from "next";
import type {
  QuestionDifficulty,
  QuestionStatus,
  QuestionType,
} from "@/domain/exams/phase2-types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAnyRoleActor } from "@/services/auth-service";
import { listQuestionsService } from "@/services/question-bank-service";
import { PageHeader } from "@/components/layout/page-header";
import { QuestionBankList } from "@/components/features/teacher/question-bank-list";

export const metadata: Metadata = {
  title: "Bank Soal",
};

export const dynamic = "force-dynamic";

export default async function TeacherQuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<{
    subjectId?: string;
    questionType?: string;
    difficulty?: string;
    status?: string;
    search?: string;
    page?: string;
  }>;
}) {
  const actor = await requireAnyRoleActor(["teacher", "admin"]);
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const data = await listQuestionsService(supabase, actor, {
    subjectId: sp.subjectId || undefined,
    questionType: (sp.questionType as QuestionType | undefined) || undefined,
    difficulty: (sp.difficulty as QuestionDifficulty | undefined) || undefined,
    status: (sp.status as QuestionStatus | "all_non_archived" | undefined) || "all_non_archived",
    search: sp.search || undefined,
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });

  return (
    <div>
      <PageHeader
        title="Bank Soal"
        description="Kelola butir soal berversi untuk mata pelajaran yang Anda ampu. Perubahan soal membentuk versi revisi baru."
      />
      <QuestionBankList
        initialQuestions={data.questions}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        authorizedSubjects={data.authorizedSubjects}
        initialFilters={sp}
      />
    </div>
  );
}
