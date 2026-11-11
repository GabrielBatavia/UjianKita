"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Search, ShieldAlert } from "lucide-react";
import type { ExamRecord } from "@/domain/exams/phase2-types";
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
import { EXAM_STATUS_META } from "@/components/features/teacher/exams-list";

export function AdminExamsOversight({
  initialExams,
  subjects,
  classes,
  initialFilters,
  timeZone,
}: {
  initialExams: ExamRecord[];
  subjects: Array<{ id: string; code: string; name: string }>;
  classes: Array<{ id: string; name: string }>;
  initialFilters: { subjectId?: string; status?: string; classId?: string; search?: string };
  timeZone: string;
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState(initialFilters.search ?? "");
  const [subjectId, setSubjectId] = React.useState(initialFilters.subjectId ?? "");
  const [status, setStatus] = React.useState(initialFilters.status ?? "");
  const [classId, setClassId] = React.useState(initialFilters.classId ?? "");

  function applyFilters() {
    const params = new URLSearchParams();
    if (subjectId) params.set("subjectId", subjectId);
    if (status) params.set("status", status);
    if (classId) params.set("classId", classId);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    router.push(qs ? `/admin/exams?${qs}` : "/admin/exams");
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            aria-label="Cari ujian sekolah"
            placeholder="Cari judul ujian..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            className="pl-9"
          />
        </div>

        <Select
          aria-label="Filter mata pelajaran"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          <option value="">Semua Mata Pelajaran</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter kelas peserta"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
        >
          <option value="">Semua Kelas</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <div className="flex gap-2">
          <Select
            aria-label="Filter status"
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
          <Button type="button" variant="secondary" onClick={applyFilters}>
            Cari
          </Button>
        </div>
      </div>

      {initialExams.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="Belum Ada Ujian di Sekolah"
          description="Ujian yang dibuat oleh guru pada sekolah Anda akan tampil di sini untuk pengawasan status dan riwayat publikasi."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Judul Ujian</TableHead>
              <TableHead>Pembuat &amp; Mapel</TableHead>
              <TableHead>Jadwal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Inspeksi</TableHead>
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
                      {exam.question_count ?? 0} soal • {exam.total_points ?? 0} poin
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium text-slate-900">
                      {exam.created_by_name ?? "Guru"}
                    </div>
                    <div className="text-slate-500">
                      {exam.subject_code} — {exam.subject_name}
                    </div>
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
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/exams/${exam.id}`}>
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Detail</span>
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
