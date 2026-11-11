import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getStudentPortal } from "@/services/student-service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Profil Siswa",
};

export const dynamic = "force-dynamic";

export default async function StudentProfilePage() {
  const actor = await requireRoleActor("student");
  const supabase = await createSupabaseServerClient();
  const portal = await getStudentPortal(supabase, actor);

  const profileRows = [
    { label: "Nama Lengkap", value: actor.fullName },
    { label: "Email Sekolah", value: actor.email },
    { label: "Sekolah", value: actor.schoolName },
    { label: "NIS", value: portal.student?.nis ?? "-" },
    { label: "NISN", value: portal.student?.nisn ?? "Belum tercatat" },
    {
      label: "Jenis Kelamin",
      value:
        portal.student?.gender === "L"
          ? "Laki-laki"
          : portal.student?.gender === "P"
            ? "Perempuan"
            : "Belum tercatat",
    },
    {
      label: "Kelas Aktif",
      value: portal.activeClass
        ? `${portal.activeClass.name} (${portal.activeClass.academic_year_name} • ${portal.activeClass.semester})`
        : "Belum ditempatkan",
    },
    { label: "Nama Wali", value: portal.student?.guardian_name ?? "Belum tercatat" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Profil Siswa"
        description="Periksa kelengkapan identitas dan kelas Anda. Hubungi administrator sekolah jika terdapat data yang perlu diperbaiki."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{actor.fullName}</CardTitle>
            <Badge variant={portal.student?.is_active ? "success" : "neutral"}>
              {portal.student?.is_active ? "Akun Aktif" : "Nonaktif"}
            </Badge>
          </div>
          <CardDescription>Data identitas resmi peserta didik</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-slate-200 text-sm">
            {profileRows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <dt className="text-slate-600">{row.label}</dt>
                <dd className="font-medium text-slate-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
