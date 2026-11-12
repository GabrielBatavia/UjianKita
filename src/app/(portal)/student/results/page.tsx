import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listStudentResultsService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { StudentResultsList } from "@/components/features/student/student-results-list";

export const metadata: Metadata = {
  title: "Hasil & Bukti Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentResultsPage() {
  const actor = await requireRoleActor("student");
  const supabase = await createSupabaseServerClient();

  let results: Awaited<ReturnType<typeof listStudentResultsService>> | null = null;
  let errorMessage: string | null = null;

  try {
    results = await listStudentResultsService(supabase, actor);
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Gagal memuat hasil ujian Anda.";
  }

  if (errorMessage || !results) {
    return (
      <Alert variant="warning" title="Data Hasil Belum Tersedia">
        {errorMessage ?? "Gagal memuat hasil ujian Anda."}
      </Alert>
    );
  }

  return <StudentResultsList results={results} timeZone={actor.timezone} />;
}
