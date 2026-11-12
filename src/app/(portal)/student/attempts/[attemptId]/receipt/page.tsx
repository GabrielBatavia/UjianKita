import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentSubmissionReceiptService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StudentSubmissionReceiptView } from "@/components/features/student/student-submission-receipt";

export const metadata: Metadata = {
  title: "Bukti Pengumpulan Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentAttemptReceiptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const actor = await requireRoleActor("student");
  const { attemptId } = await params;
  const supabase = await createSupabaseServerClient();

  let receipt: Awaited<ReturnType<typeof getStudentSubmissionReceiptService>> | null = null;
  let errorMessage: string | null = null;

  try {
    receipt = await getStudentSubmissionReceiptService(supabase, actor, attemptId);
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Bukti pengumpulan tidak ditemukan.";
  }

  if (errorMessage || !receipt) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" title="Bukti Pengumpulan Belum Tersedia">
          {errorMessage ?? "Bukti pengumpulan tidak ditemukan."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/student/results">Kembali ke Riwayat &amp; Hasil</Link>
        </Button>
      </div>
    );
  }

  return <StudentSubmissionReceiptView receipt={receipt} timeZone={actor.timezone} />;
}
