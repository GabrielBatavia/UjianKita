import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { UpcomingModuleCard } from "@/components/layout/upcoming-module-card";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata: Metadata = {
  title: "Jadwal Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentExamsPlaceholderPage() {
  await requireRoleActor("student");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ujian Mendatang"
        description="Daftar ujian yang berhak Anda ikuti akan muncul di halaman ini."
      />

      <EmptyState
        icon={ClipboardList}
        title="Belum Ada Ujian yang Dijadwalkan"
        description="Mesin pelaksanaan ujian dijadwalkan aktif pada Fase 2. Pada Fase 1, tidak ada jadwal ujian atau soal simulasi yang ditampilkan."
      />

      <UpcomingModuleCard
        title="Cara Kerja Pelaksanaan Ujian (Fase 2)"
        phaseLabel="Dijadwalkan pada Fase 2"
        description="Setiap percobaan ujian akan dilindungi dengan keandalan penuh di server sekolah."
        plannedCapabilities={[
          "Waktu ujian dikendalikan oleh server sekolah, bukan jam pada ponsel.",
          "Setiap jawaban hanya berstatus 'Jawaban tersimpan' setelah dikonfirmasi oleh basis data server.",
          "Jika koneksi terputus atau halaman dimuat ulang, jawaban yang sudah dikonfirmasi akan dipulihkan otomatis.",
        ]}
      />
    </div>
  );
}
