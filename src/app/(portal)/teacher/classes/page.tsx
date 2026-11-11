import type { Metadata } from "next";
import { School } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getTeacherWorkspace } from "@/services/teacher-service";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Kelas Diampu",
};

export const dynamic = "force-dynamic";

export default async function TeacherClassesPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();
  const { assignedClasses } = await getTeacherWorkspace(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Kelas yang Diampu"
        description="Daftar kelas yang ditetapkan kepada Anda sebagai guru mata pelajaran maupun wali kelas."
      />

      {assignedClasses.length === 0 ? (
        <EmptyState
          icon={School}
          title="Belum Ada Penugasan Kelas"
          description="Administrator sekolah belum menetapkan kelas kepada akun Anda. Hubungi administrator sekolah apabila penugasan sudah seharusnya tampil."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {assignedClasses.map((cls) => (
            <Card key={cls.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{cls.name}</CardTitle>
                    <CardDescription>
                      Tingkat {cls.grade_level}
                      {cls.program ? ` • ${cls.program}` : ""} • {cls.academic_year_name} (
                      {cls.semester})
                    </CardDescription>
                  </div>
                  {cls.is_homeroom ? <Badge variant="default">Wali Kelas</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-700">
                  Siswa terdaftar aktif: <span className="font-semibold">{cls.student_count}</span>
                </p>
                {cls.subjects.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {cls.subjects.map((subj) => (
                      <Badge key={subj.id} variant="neutral">
                        {subj.code} — {subj.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Ditugaskan sebagai wali kelas (belum ada mata pelajaran spesifik).
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
