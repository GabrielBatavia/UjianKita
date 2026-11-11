import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubjectsPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { SubjectsManager } from "@/components/features/admin/subjects-manager";

export const metadata: Metadata = {
  title: "Mata Pelajaran",
};

export const dynamic = "force-dynamic";

export default async function AdminSubjectsPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { subjects } = await getSubjectsPageData(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Mata Pelajaran"
        description="Daftar mata pelajaran resmi sekolah yang digunakan pada penugasan guru dan bank soal."
      />
      <SubjectsManager initialSubjects={subjects} />
    </div>
  );
}
