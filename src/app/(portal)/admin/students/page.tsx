import type { Metadata } from "next";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentsPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { StudentsManager } from "@/components/features/admin/students-manager";

export const metadata: Metadata = {
  title: "Manajemen Siswa",
};

export const dynamic = "force-dynamic";

export default async function AdminStudentsPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { students, classes } = await getStudentsPageData(supabase, actor);
  const envStatus = getPublicEnvStatus();

  return (
    <div>
      <PageHeader
        title="Manajemen Siswa"
        description="Kelola akun siswa, nomor induk (NIS/NISN), status aktif, serta penempatan kelas."
      />
      <StudentsManager
        initialStudents={students}
        classes={classes}
        serviceRoleConfigured={envStatus.serviceRoleConfigured}
      />
    </div>
  );
}
