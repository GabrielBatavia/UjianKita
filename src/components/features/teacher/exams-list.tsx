"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Eye, Plus, Search, Settings2 } from "lucide-react";
import type { ExamRecord, ExamStatus } from "@/domain/exams/phase2-types";
import { formatDateTimeId } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";

export const EXAM_STATUS_META: Record<
  ExamStatus,
  { label: string; variant: "default" | "warning" | "success" | "neutral" | "danger" }
> = {
  DRAFT: { label: "Draf", variant: "default" },
  READY_FOR_REVIEW: { label: "Siap Tinjau", variant: "warning" },
  PUBLISHED: { label: "Diterbitkan", variant: "success" },
  CLOSED: { label: "Ditutup", variant: "neutral" },
  ARCHIVED: { label: "Diarsipkan", variant: "neutral" },
};

export function ExamsList({
  initialExams,
  authorizedSubjects,
  initialFilters,
  timeZone,
}: {
  initialExams: ExamRecord[];
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
  initialFilters: { subjectId?: string; status?: string; search?: string };
  timeZone: string;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState(initialFilters.search ?? "");
  const [subjectId, setSubjectId] = React.useState(initialFilters.subjectId ?? "");
  const [status, setStatus] = React.useState(initialFilters.status ?? "");

  function applyFilters() {
    const params = new URLSearchParams();
    if (subjectId) params.set("subjectId", subjectId);
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    router.push(qs ? `/teacher/exams?${qs}` : "/teacher/exams");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              aria-label="Cari judul ujian"
              placeholder="Cari judul ujian..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className="pl-9"
            />
          </div>

          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter mata pelajaran ujian"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Semua Mata Pelajaran</option>
              {authorizedSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-full sm:w-44">
            <Select
              aria-label="Filter status ujian"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Semua Status</option>
              <option value="DRAFT">Draf</option>
              <option value="READY_FOR_REVIEW">Siap Tinjau</option>
              <option value="PUBLISHED">Diterbitkan</option>
              <option value="CLOSED">Ditutup</option>
              <option value="ARCHIVED">Diarsipkan</option>
            </Select>
          </div>

          <Button type="button" variant="secondary" size="sm" onClick={applyFilters}>
            Filter
          </Button>
        </div>

        <Button asChild>
          <Link href="/teacher/exams/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Buat Ujian</span>
          </Link>
        </Button>
      </div>

      {initialExams.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum Ada Ujian"
          description="Buat draf ujian baru, pilih soal dari bank soal, atur jadwal dan kelas peserta, lalu pratinjau sebelum menerbitkan."
          action={
            <Button asChild>
              <Link href="/teacher/exams/new">Buat Ujian Pertama</Link>
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Judul &amp; Mapel</TableHead>
              <TableHead>Soal &amp; Poin</TableHead>
              <TableHead>Jadwal &amp; Kelas</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialExams.map((exam) => {
              const meta = EXAM_STATUS_META[exam.status];
              return (
                <TableRow key={exam.id}>
                  <TableCell>
                    <div className="font-semibold text-slate-900">{exam.title}</div>
                    <div className="text-xs text-slate-500">
                      {exam.subject_code} — {exam.subject_name} • {exam.duration_minutes} menit
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div>{exam.question_count ?? 0} soal</div>
                    <div className="text-slate-500">{exam.total_points ?? 0} poin</div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    <div>{exam.assigned_class_count ?? 0} kelas</div>
                    <div>
                      {exam.starts_at
                        ? formatDateTimeId(exam.starts_at, timeZone)
                        : "Belum dijadwalkan"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/teacher/exams/${exam.id}/preview`}>
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Pratinjau</span>
                        </Link>
                      </Button>
                      <Button asChild size="sm">
                        <Link href={`/teacher/exams/${exam.id}`}>
                          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Kelola</span>
                        </Link>
                      </Button>
                    </div>
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
