import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClassesPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { ClassesManager } from "@/components/features/admin/classes-manager";

export const metadata: Metadata = {
  title: "Manajemen Kelas",
};

export const dynamic = "force-dynamic";

export default async function AdminClassesPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { classes, academicYears, teachers } = await getClassesPageData(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Kelas &amp; Tahun Ajaran"
        description="Atur tahun ajaran aktif, daftar rombongan belajar, wali kelas, dan kapasitas."
      />
      <ClassesManager
        initialClasses={classes}
        initialAcademicYears={academicYears}
        teachers={teachers}
      />
    </div>
  );
}
