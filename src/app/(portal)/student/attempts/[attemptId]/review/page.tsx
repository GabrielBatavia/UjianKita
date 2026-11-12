import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentAttemptWorkspaceService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StudentAttemptReview } from "@/components/features/student/student-attempt-review";

export const metadata: Metadata = {
  title: "Tinjauan Akhir Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentAttemptReviewPage({
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
    errorMessage = isServiceError(error) ? error.message : "Sesi tinjauan ujian tidak ditemukan.";
  }

  if (errorMessage || !workspace) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <Alert variant="danger" title="Sesi Tidak Ditemukan">
          {errorMessage ?? "Sesi tinjauan ujian tidak ditemukan."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/student/exams">Kembali ke Daftar Ujian</Link>
        </Button>
      </div>
    );
  }

  return <StudentAttemptReview workspace={workspace} />;
}
