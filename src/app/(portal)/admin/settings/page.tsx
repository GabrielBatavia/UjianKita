import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSettingsPageData } from "@/services/admin-service";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsManager } from "@/components/features/admin/settings-manager";

export const metadata: Metadata = {
  title: "Pengaturan & Log Audit",
};

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const actor = await requireRoleActor("admin");
  const supabase = await createSupabaseServerClient();
  const { school, auditEvents } = await getSettingsPageData(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Pengaturan Sekolah &amp; Log Audit"
        description="Kelola profil sekolah, kebijakan dasar ujian, serta tinjau catatan audit keamanan."
      />
      <SettingsManager school={school} auditEvents={auditEvents} />
    </div>
  );
}
