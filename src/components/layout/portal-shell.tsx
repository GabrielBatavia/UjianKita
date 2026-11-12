"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  Database,
  Eye,
  FilePlus2,
  FileSpreadsheet,
  GraduationCap,
  History,
  LayoutDashboard,
  Menu,
  PlusCircle,
  School,
  Settings,
  ShieldAlert,
  UserCheck,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import type { AuthenticatedActor, Phase1RoleCode } from "@/domain/auth/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LogoutButton } from "@/components/layout/logout-button";

export type NavIconName =
  | "dashboard"
  | "students"
  | "teachers"
  | "classes"
  | "subjects"
  | "settings"
  | "exams"
  | "history"
  | "profile"
  | "questions"
  | "newQuestion"
  | "importQuestions"
  | "newExam"
  | "schedules"
  | "grading"
  | "oversight"
  | "preview";

export interface PortalNavItem {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: string;
}

const ICON_MAP: Record<NavIconName, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  students: GraduationCap,
  teachers: UserCheck,
  classes: School,
  subjects: BookOpen,
  settings: Settings,
  exams: ClipboardList,
  history: History,
  profile: UserCircle,
  questions: Database,
  newQuestion: FilePlus2,
  importQuestions: FileSpreadsheet,
  newExam: PlusCircle,
  schedules: CalendarClock,
  grading: CheckSquare,
  oversight: ShieldAlert,
  preview: Eye,
};

const ROLE_LABELS: Record<Phase1RoleCode, string> = {
  admin: "Administrator",
  teacher: "Guru",
  student: "Siswa",
};

export function getNavItemsForRole(role: Phase1RoleCode): PortalNavItem[] {
  if (role === "admin") {
    return [
      { href: "/admin", label: "Ringkasan", icon: "dashboard" },
      { href: "/admin/students", label: "Data Siswa", icon: "students" },
      { href: "/admin/teachers", label: "Data Guru", icon: "teachers" },
      { href: "/admin/classes", label: "Kelas & Tahun Ajaran", icon: "classes" },
      { href: "/admin/subjects", label: "Mata Pelajaran", icon: "subjects" },
      { href: "/admin/exams", label: "Pengawasan Ujian", icon: "oversight" },
      { href: "/admin/monitoring", label: "Pusat Keamanan", icon: "oversight" },
      { href: "/admin/settings", label: "Pengaturan & Audit", icon: "settings" },
    ];
  }

  if (role === "teacher") {
    return [
      { href: "/teacher", label: "Ringkasan", icon: "dashboard" },
      { href: "/teacher/classes", label: "Kelas Diampu", icon: "classes" },
      { href: "/teacher/subjects", label: "Mata Pelajaran", icon: "subjects" },
      { href: "/teacher/questions", label: "Bank Soal", icon: "questions" },
      { href: "/teacher/questions/new", label: "Buat Soal", icon: "newQuestion" },
      { href: "/teacher/questions/import", label: "Impor Soal", icon: "importQuestions" },
      { href: "/teacher/exams", label: "Manajemen Ujian", icon: "exams" },
      { href: "/teacher/exams/new", label: "Buat Ujian", icon: "newExam" },
      { href: "/teacher/schedules", label: "Jadwal Ujian", icon: "schedules" },
      { href: "/teacher/monitoring", label: "Pemantauan Ujian", icon: "oversight" },
      { href: "/teacher/grading", label: "Penilaian & Hasil", icon: "grading" },
    ];
  }

  return [
    { href: "/student", label: "Beranda", icon: "dashboard" },
    { href: "/student/exams", label: "Ujian", icon: "exams" },
    { href: "/student/results", label: "Hasil & Bukti", icon: "history" },
    { href: "/student/profile", label: "Profil", icon: "profile" },
  ];
}

export function PortalShell({
  actor,
  children,
}: {
  actor: AuthenticatedActor;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const navItems = getNavItemsForRole(actor.primaryRole);

  const isNavItemActive = (href: string) => {
    if (
      href === "/admin" ||
      href === "/teacher" ||
      href === "/student" ||
      href === "/teacher/questions/new" ||
      href === "/teacher/questions/import" ||
      href === "/teacher/exams/new"
    ) {
      return pathname === href;
    }
    if (href === "/teacher/questions") {
      return (
        pathname === href ||
        (pathname.startsWith("/teacher/questions/") &&
          !pathname.startsWith("/teacher/questions/new") &&
          !pathname.startsWith("/teacher/questions/import"))
      );
    }
    if (href === "/teacher/exams") {
      return (
        pathname === href ||
        (pathname.startsWith("/teacher/exams/") &&
          !pathname.startsWith("/teacher/exams/new") &&
          !pathname.endsWith("/grading"))
      );
    }
    if (href === "/teacher/grading") {
      return (
        pathname === href ||
        pathname.startsWith("/teacher/grading") ||
        pathname.startsWith("/teacher/results") ||
        pathname.startsWith("/teacher/attempts/") ||
        (pathname.startsWith("/teacher/exams/") && pathname.endsWith("/grading"))
      );
    }
    if (href === "/student/results") {
      return (
        pathname === href ||
        pathname.startsWith("/student/results") ||
        pathname.startsWith("/student/history") ||
        (pathname.startsWith("/student/attempts/") && pathname.endsWith("/receipt"))
      );
    }
    if (href === "/student/exams") {
      return (
        pathname === href ||
        pathname.startsWith("/student/exams/") ||
        (pathname.startsWith("/student/attempts/") && !pathname.endsWith("/receipt"))
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isFocusExamSession =
    actor.primaryRole === "student" &&
    pathname.startsWith("/student/attempts/") &&
    !pathname.endsWith("/receipt");

  if (isFocusExamSession) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-blue-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Langsung ke konten ujian
        </a>
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-blue-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Langsung ke konten utama
      </a>

      {/* Desktop Left Sidebar */}
      <aside
        aria-label="Navigasi utama"
        className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex"
      >
        <div className="flex h-16 items-center border-b border-slate-200 px-5">
          <BrandLogo href={`/${actor.primaryRole}`} />
        </div>

        <div className="border-b border-slate-100 px-5 py-3.5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Sekolah</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{actor.schoolName}</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="default">{ROLE_LABELS[actor.primaryRole]}</Badge>
            <span className="text-xs text-slate-500">{actor.schoolLevel}</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = ICON_MAP[item.icon];
            const active = isNavItemActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[42px] items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-blue-50 text-blue-800 font-semibold"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    className={cn("h-4 w-4 shrink-0", active ? "text-blue-700" : "text-slate-500")}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </span>
                {item.badge ? (
                  <Badge variant="neutral" className="text-[10px] px-2 py-0">
                    {item.badge}
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <Users className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{actor.fullName}</p>
              <p className="truncate text-xs text-slate-500">{actor.email}</p>
            </div>
          </div>
          <LogoutButton className="w-full" />
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Top Bar (Mobile + Contextual Status) */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            <BrandLogo href={`/${actor.primaryRole}`} />
          </div>

          <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex">
            <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <span>Zona waktu sekolah: {actor.timezone}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-900">{actor.fullName}</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[actor.primaryRole]}</p>
            </div>
            <div className="lg:hidden">
              <LogoutButton />
            </div>
          </div>
        </header>

        {/* Mobile Drawer Navigation */}
        {mobileMenuOpen ? (
          <div className="border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <div className="mb-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">{actor.schoolName}</p>
                <p className="truncate text-xs text-slate-500">{actor.email}</p>
              </div>
              <Badge variant="default">{ROLE_LABELS[actor.primaryRole]}</Badge>
            </div>
            <nav aria-label="Menu seluler" className="space-y-1">
              {navItems.map((item) => {
                const Icon = ICON_MAP[item.icon];
                const active = isNavItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-sm font-medium",
                      active
                        ? "bg-blue-50 text-blue-800 font-semibold"
                        : "text-slate-700 hover:bg-slate-100"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </span>
                    {item.badge ? (
                      <Badge variant="neutral" className="text-[10px]">
                        {item.badge}
                      </Badge>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}

        <main
          id="main-content"
          className={cn(
            "flex-1 px-4 py-6 sm:px-6 lg:px-8",
            actor.primaryRole === "student" ? "pb-24 lg:pb-8" : ""
          )}
        >
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        {/* Mobile Bottom Navigation Bar optimized for Students on Android ExamBro / iPhone SEB */}
        {actor.primaryRole === "student" ? (
          <nav
            aria-label="Navigasi cepat siswa"
            className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white lg:hidden"
          >
            {navItems.map((item) => {
              const Icon = ICON_MAP[item.icon];
              const active = isNavItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium",
                    active ? "text-blue-700 font-semibold" : "text-slate-600"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
