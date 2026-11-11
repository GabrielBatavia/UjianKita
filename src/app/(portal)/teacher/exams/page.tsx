import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { requireRoleActor } from "@/services/auth-service";
import { PageHeader } from "@/components/layout/page-header";
import { UpcomingModuleCard } from "@/components/layout/upcoming-module-card";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Modul Ujian (Fase 2)",
};

export const dynamic = "force-dynamic";

export default async function TeacherExamsPlaceholderPage() {
  await requireRoleActor("teacher");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manajemen Ujian &amp; Bank Soal"
        description="Area ini dipersiapkan untuk alur kerja pembuatan soal, penerbitan ujian, pemantauan, dan koreksi nilai."
      />

      <Alert variant="info" title="Status Implementasi Fase 1">
        <span className="inline-flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Modul bank soal dan pelaksanaan ujian belum aktif pada Fase 1. Tidak ada data ujian atau
            nilai simulasi palsu yang ditampilkan di halaman ini.
          </span>
        </span>
      </Alert>

      <div className="grid gap-5 lg:grid-cols-2">
        <UpcomingModuleCard
          title="1. Bank Soal &amp; Versi Soal"
          phaseLabel="Fase 2"
          description="Pembuatan dan kurasi soal terstruktur dengan pemisahan ketat antara draf dan kunci jawaban resmi."
          plannedCapabilities={[
            "Mendukung Pilihan Ganda, Pilihan Jamak, Benar/Salah, Isian Singkat, Menjodohkan, Numerik, dan Esai.",
            "Riwayat revisi soal serta dukungan gambar dan notasi matematika LaTeX yang aksesibel.",
            "Kunci jawaban disimpan terpisah dan tidak pernah dikirim ke perangkat siswa sebelum rilis resmi.",
          ]}
        />

        <UpcomingModuleCard
          title="2. Perakitan &amp; Persetujuan Ujian"
          phaseLabel="Fase 2"
          description="Pengaturan jadwal, pengacakan soal, dan penguncian versi ujian yang tidak dapat diubah diam-diam."
          plannedCapabilities={[
            "Penetapan kelas peserta, jendela waktu server (WIB/WITA/WIT), dan batas keterlambatan.",
            "Pratinjau tampilan siswa dan persetujuan penerbitan versi ujian yang imutabel.",
            "Konfigurasi integrasi ExamBro (Android) dan Safe Exam Browser (iOS).",
          ]}
        />

        <UpcomingModuleCard
          title="3. Pemantauan Sesi Langsung"
          phaseLabel="Fase 3"
          description="Visibilitas status koneksi, progres pengerjaan, dan catatan kejadian selama ujian berlangsung."
          plannedCapabilities={[
            "Pemantauan progres penyimpanan jawaban dan jeda heartbeat per peserta.",
            "Pelabelan kejadian berbasis bukti (mis. jeda visibilitas halaman, bukan tuduhan otomatis).",
            "Pencatatan insiden pengawas dan perpanjangan waktu yang diaudit.",
          ]}
        />

        <UpcomingModuleCard
          title="4. Penilaian &amp; Rekap Nilai Resmi"
          phaseLabel="Fase 2 &amp; Fase 3"
          description="Penilaian otomatis di server untuk soal objektif dan koreksi esai berbantuan rubrik."
          plannedCapabilities={[
            "Rekalkulasi skor deterministik berdasarkan versi ujian dan pemetaan acak tiap percobaan.",
            "Alur penyesuaian nilai dengan alasan wajib dan jejak audit permanen.",
            "Ekspor laporan nilai resmi setelah persetujuan rilis.",
          ]}
        />
      </div>
    </div>
  );
}
