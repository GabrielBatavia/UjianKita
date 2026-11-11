import type { Metadata } from "next";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTeachersPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { TeachersManager } from "@/components/features/admin/teachers-manager";

export const metadata: Metadata = {
  title: "Manajemen Guru",
};

export const dynamic = "force-dynamic";

export default async function AdminTeachersPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { teachers, classes, subjects, academicYears } = await getTeachersPageData(
    supabase,
    actor
  );
  const envStatus = getPublicEnvStatus();

  return (
    <div>
      <PageHeader
        title="Manajemen Guru"
        description="Kelola akun guru, status kepegawaian, serta penugasan kelas dan mata pelajaran."
      />
      <TeachersManager
        initialTeachers={teachers}
        classes={classes}
        subjects={subjects}
        academicYears={academicYears}
        serviceRoleConfigured={envStatus.serviceRoleConfigured}
      />
    </div>
  );
}
