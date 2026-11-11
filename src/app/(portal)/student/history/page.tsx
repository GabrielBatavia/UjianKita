import type { Metadata } from "next";
import { History } from "lucide-react";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { UpcomingModuleCard } from "@/components/layout/upcoming-module-card";

export const metadata: Metadata = {
  title: "Riwayat Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentHistoryPlaceholderPage() {
  await requireRoleActor("student");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Riwayat Ujian"
        description="Catatan keikutsertaan ujian, nomor bukti pengumpulan, dan nilai resmi."
      />

      <EmptyState
        icon={History}
        title="Belum Ada Riwayat Ujian"
        description="Anda belum memiliki catatan ujian karena modul pelaksanaan dan penilaian ujian belum diaktifkan pada Fase 1."
      />

      <UpcomingModuleCard
        title="Bukti Pengumpulan & Rilis Nilai (Fase 2)"
        phaseLabel="Dijadwalkan pada Fase 2"
        description="Setelah Anda mengumpulkan ujian secara sah, sistem akan menerbitkan tanda terima atomik dan menampilkan nilai setelah dirilis oleh guru."
        plannedCapabilities={[
          "Nomor bukti pengumpulan (Receipt ID) dengan stempel waktu server UTC/WIB.",
          "Nilai hanya ditampilkan setelah disetujui oleh guru atau koordinator ujian.",
          "Catatan penyesuaian nilai tercatat dalam riwayat audit resmi.",
        ]}
      />
    </div>
  );
}
