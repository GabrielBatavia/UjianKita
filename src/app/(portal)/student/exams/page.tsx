import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listStudentAvailableExamsService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { Alert } from "@/components/ui/alert";
import { StudentExamsCatalog } from "@/components/features/student/student-exams-catalog";

export const metadata: Metadata = {
  title: "Daftar Ujian Siswa",
};

export const dynamic = "force-dynamic";

export default async function StudentExamsPage() {
  const actor = await requireRoleActor("student");
  const supabase = await createSupabaseServerClient();

  let data: Awaited<ReturnType<typeof listStudentAvailableExamsService>> | null = null;
  let errorMessage: string | null = null;

  try {
    data = await listStudentAvailableExamsService(supabase, actor);
  } catch (error) {
    errorMessage = isServiceError(error)
      ? error.message
      : "Tidak dapat memuat daftar ujian Anda saat ini.";
  }

  if (errorMessage || !data) {
    return (
      <Alert variant="warning" title="Ujian Belum Tersedia">
        {errorMessage ?? "Tidak dapat memuat daftar ujian Anda saat ini."}
      </Alert>
    );
  }

  return (
    <StudentExamsCatalog
      className={data.className}
      studentNis={data.studentNis}
      items={data.items}
      timeZone={actor.timezone}
    />
  );
}
