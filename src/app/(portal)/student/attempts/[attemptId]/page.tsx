import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentAttemptWorkspaceService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExamPlayerClient } from "@/components/features/student/exam-player-client";

export const metadata: Metadata = {
  title: "Pengerjaan Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentAttemptPlayerPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const actor = await requireRoleActor("student");
  const { attemptId } = await params;
  const supabase = await createSupabaseServerClient();

  let workspace: Awaited<ReturnType<typeof getStudentAttemptWorkspaceService>> | null = null;
  let errorMessage: string | null = null;

  try {
    workspace = await getStudentAttemptWorkspaceService(supabase, actor, attemptId);
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Sesi ujian tidak ditemukan.";
  }

  if (errorMessage || !workspace) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <Alert variant="danger" title="Sesi Ujian Tidak Dapat Dimuat">
          {errorMessage ?? "Sesi ujian tidak ditemukan."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/student/exams">Kembali ke Daftar Ujian</Link>
        </Button>
      </div>
    );
  }

  return <ExamPlayerClient initialWorkspace={workspace} />;
}
