import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { getTeacherWorkspace } from "@/services/teacher-service";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Mata Pelajaran Diampu",
};

export const dynamic = "force-dynamic";

export default async function TeacherSubjectsPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();
  const { assignedSubjects } = await getTeacherWorkspace(supabase, actor);

  return (
    <div>
      <PageHeader
        title="Mata Pelajaran Diampu"
        description="Mata pelajaran yang menjadi tanggung jawab pengajaran Anda pada tahun ajaran berjalan."
      />

      {assignedSubjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Belum Ada Mata Pelajaran Ditugaskan"
          description="Penugasan mata pelajaran diatur oleh administrator sekolah pada menu Manajemen Guru."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {assignedSubjects.map((subj) => (
            <Card key={subj.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="default" className="font-mono">
                    {subj.code}
                  </Badge>
                  <Badge variant="neutral">{subj.curriculum_group}</Badge>
                </div>
                <CardTitle className="mt-2">{subj.name}</CardTitle>
                {subj.description ? <CardDescription>{subj.description}</CardDescription> : null}
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Kelas yang Diajar
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {subj.classes.map((c) => (
                    <Badge key={c.id} variant="neutral">
                      {c.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
