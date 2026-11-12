import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getExamAttemptsGradingListService } from "@/services/grading-service";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TeacherGradingWorkspace } from "@/components/features/teacher/teacher-grading-workspace";

export const metadata: Metadata = {
  title: "Ruang Penilaian Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherExamGradingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRoleActor("teacher");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  let data: Awaited<ReturnType<typeof getExamAttemptsGradingListService>> | null = null;
  let errorMessage: string | null = null;

  try {
    data = await getExamAttemptsGradingListService(supabase, actor, id);
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Gagal memuat ruang penilaian ujian.";
  }

  if (errorMessage || !data) {
    return (
      <div className="space-y-4">
        <Alert variant="danger" title="Penilaian Tidak Dapat Dimuat">
          {errorMessage ?? "Gagal memuat ruang penilaian ujian."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/teacher/grading">Kembali ke Daftar Penilaian</Link>
        </Button>
      </div>
    );
  }

  return (
    <TeacherGradingWorkspace
      exam={data.exam}
      initialAttempts={data.attempts}
      timeZone={actor.timezone}
    />
  );
}
