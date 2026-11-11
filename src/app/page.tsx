import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PHASE1_PILLARS = [
  {
    icon: Lock,
    title: "Autentikasi & Kontrol Akses Server",
    description:
      "Sesi aman berbasis Supabase Auth dengan otorisasi peran (Admin, Guru, Siswa) yang diverifikasi langsung di server dan kebijakan Row Level Security (RLS).",
  },
  {
    icon: Users,
    title: "Manajemen Akademik Terstruktur",
    description:
      "Pengelolaan data siswa, guru, tahun ajaran, kelas, mata pelajaran, penugasan mengajar, serta pencatatan log audit tindakan sensitif.",
  },
  {
    icon: Smartphone,
    title: "Siap Mobile untuk ExamBro & SEB",
    description:
      "Antarmuka siswa dirancang mobile-first untuk ponsel Android dan iPhone dengan dukungan arsitektur integrasi ExamBro dan Safe Exam Browser (SEB).",
  },
  {
    icon: BookOpenCheck,
    title: "Fondasi Ujian Berintegritas Tinggi",
    description:
      "Dirancang untuk Fase 2 dengan kontrak penyimpanan jawaban idempoten, revisi monotonik, pengatur waktu otoritatif server, dan bukti pengumpulan.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLogo href="/" />
          <div className="flex items-center gap-3">
            <Link
              href="/api/health"
              className="hidden text-xs font-medium text-slate-600 hover:text-slate-900 sm:inline-block"
            >
              Status Sistem
            </Link>
            <Button asChild size="sm">
              <Link href="/login">
                <span>Masuk Portal</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-slate-200 bg-slate-50/70 py-14 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-3xl">
              <Badge variant="default" className="mb-4">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Fase 1 — Fondasi Platform &amp; Administrasi Akademik</span>
              </Badge>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                Platform Ujian Sekolah Berbasis Komputer yang Terukur dan Terpercaya
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
                UjianKita dibangun untuk mendukung pelaksanaan ujian resmi sekolah secara web-first
                di ponsel Android (ExamBro) dan iPhone (Safe Exam Browser), dengan kontrol akses
                ketat dan perlindungan data siswa di server sekolah.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/login">
                    <span>Masuk ke UjianKita</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href="#arsitektur-fase1">Lihat Cakupan Fase 1</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="arsitektur-fase1" className="py-14 sm:py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Pilar Arsitektur UjianKita
              </h2>
              <p className="mt-2 text-sm text-slate-600 sm:text-base">
                Fase 1 berfokus pada fondasi keamanan, manajemen data akademik, dan kesiapan
                operasional sebelum aktivasi mesin ujian pada Fase 2.
              </p>
            </div>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              {PHASE1_PILLARS.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.title}>
                    <CardHeader className="pb-3">
                      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <CardTitle>{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="leading-relaxed">
                        {item.description}
                      </CardDescription>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Role & Status Summary */}
        <section className="border-t border-slate-200 bg-slate-50 py-14">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <Badge variant="default" className="w-fit">
                    Administrator
                  </Badge>
                  <CardTitle className="mt-2">Tata Kelola Sekolah</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span>Kelola akun siswa, guru, dan penugasan mengajar.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span>Atur tahun ajaran, kelas, mata pelajaran, dan kebijakan ujian.</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <Badge variant="neutral" className="w-fit">
                    Guru
                  </Badge>
                  <CardTitle className="mt-2">Ruang Kerja Pengajar</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span>Akses daftar kelas dan mata pelajaran yang diampu.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                    <span>Bank soal, perakitan ujian, dan koreksi disiapkan untuk Fase 2.</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <Badge variant="success" className="w-fit">
                    Siswa
                  </Badge>
                  <CardTitle className="mt-2">Portal Ujian Seluler</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span>Lihat profil siswa, kelas aktif, dan daftar mata pelajaran.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                    <span>Pelaksanaan ujian dan riwayat nilai tersedia mulai Fase 2.</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6">
          <p>UjianKita — Fondasi Fase 1 (Belum untuk pelaksanaan ujian resmi sebelum Fase 2 selesai).</p>
          <div className="flex items-center gap-4">
            <Link href="/login" className="font-medium text-slate-700 hover:text-blue-700">
              Masuk
            </Link>
            <Link href="/forgot-password" className="font-medium text-slate-700 hover:text-blue-700">
              Lupa Kata Sandi
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
