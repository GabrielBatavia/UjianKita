import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentExamOverviewService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StudentExamInstructions } from "@/components/features/student/student-exam-instructions";

export const metadata: Metadata = {
  title: "Detail Ujian Siswa",
};

export const dynamic = "force-dynamic";

export default async function StudentExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const actor = await requireRoleActor("student");
  const { examId } = await params;
  const supabase = await createSupabaseServerClient();

  let exam: Awaited<ReturnType<typeof getStudentExamOverviewService>> | null = null;
  let errorMessage: string | null = null;

  try {
    exam = await getStudentExamOverviewService(supabase, actor, examId);
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Detail ujian tidak ditemukan.";
  }

  if (errorMessage || !exam) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" title="Ujian Tidak Tersedia">
          {errorMessage ?? "Detail ujian tidak ditemukan."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/student/exams">Kembali ke Daftar Ujian</Link>
        </Button>
      </div>
    );
  }

  return <StudentExamInstructions exam={exam} timeZone={actor.timezone} />;
}
