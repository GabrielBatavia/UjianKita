import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Settings2 } from "lucide-react";
import { formatDateTimeId } from "@/lib/utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchSchoolSchedules } from "@/repositories/exam-repository";
import { requireRoleActor } from "@/services/auth-service";
import { getAuthorizedClassesForActor } from "@/services/exam-service";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EXAM_STATUS_META } from "@/components/features/teacher/exams-list";

export const metadata: Metadata = {
  title: "Jadwal Ujian",
};

export const dynamic = "force-dynamic";

export default async function TeacherSchedulesPage() {
  const actor = await requireRoleActor("teacher");
  const supabase = await createSupabaseServerClient();

  const [allSchedules, authorizedClasses] = await Promise.all([
    fetchSchoolSchedules(supabase, actor.schoolId),
    getAuthorizedClassesForActor(supabase, actor),
  ]);

  const classIdSet = new Set(authorizedClasses.map((c) => c.id));
  const schedules = allSchedules.filter((s) => classIdSet.has(s.class_id));

  return (
    <div>
      <PageHeader
        title="Jadwal Ujian Kelas"
        description={`Menampilkan jadwal ujian untuk kelas yang Anda ampu dalam zona waktu ${actor.timezone}.`}
        actions={
          <Button asChild size="sm">
            <Link href="/teacher/exams/new">Buat &amp; Jadwalkan Ujian</Link>
          </Button>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Belum Ada Ujian Terjadwal"
          description="Tetapkan kelas dan jendela waktu pada ujian di menu Manajemen Ujian untuk melihat jadwal di sini."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ujian &amp; Mapel</TableHead>
              <TableHead>Kelas</TableHead>
              <TableHead>Mulai ({actor.timezone})</TableHead>
              <TableHead>Selesai</TableHead>
              <TableHead>Durasi &amp; Browser</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((s) => {
              const statusMeta = s.exam_status ? EXAM_STATUS_META[s.exam_status] : null;
              return (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{s.exam_title ?? "-"}</div>
                    <div className="text-xs text-slate-500">{s.subject_name ?? "-"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">{s.class_name}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-700">
                    {formatDateTimeId(s.starts_at, actor.timezone)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-700">
                    {formatDateTimeId(s.ends_at, actor.timezone)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    <div>{s.duration_minutes} menit</div>
                    <div>{s.require_exam_browser ? "ExamBro / SEB" : "Bebas"}</div>
                  </TableCell>
                  <TableCell>
                    {statusMeta ? (
                      <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/teacher/exams/${s.exam_id}`}>
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Kelola</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
