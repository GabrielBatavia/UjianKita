"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Copy,
  Database,
  Edit3,
  Eye,
  FileSpreadsheet,
  Plus,
  Search,
} from "lucide-react";
import type {
  QuestionDifficulty,
  QuestionRecord,
  QuestionStatus,
  QuestionType,
} from "@/domain/exams/phase2-types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { QuestionContentRenderer } from "@/components/features/exams/question-content-renderer";

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Pilihan Ganda",
  multiple_choice: "Pilihan Jamak",
  true_false: "Benar / Salah",
  essay: "Esai",
};

const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  easy: "Mudah",
  medium: "Sedang",
  hard: "Sulit",
};

const STATUS_LABELS: Record<QuestionStatus, { label: string; variant: "default" | "success" | "neutral" }> = {
  draft: { label: "Draf", variant: "default" },
  active: { label: "Aktif", variant: "success" },
  archived: { label: "Diarsipkan", variant: "neutral" },
};

export function QuestionBankList({
  initialQuestions,
  total,
  page,
  pageSize,
  authorizedSubjects,
  initialFilters,
}: {
  initialQuestions: QuestionRecord[];
  total: number;
  page: number;
  pageSize: number;
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
  initialFilters: {
    subjectId?: string;
    questionType?: string;
    difficulty?: string;
    status?: string;
    search?: string;
  };
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState(initialFilters.search ?? "");
  const [subjectId, setSubjectId] = React.useState(initialFilters.subjectId ?? "");
  const [questionType, setQuestionType] = React.useState(initialFilters.questionType ?? "");
  const [difficulty, setDifficulty] = React.useState(initialFilters.difficulty ?? "");
  const [status, setStatus] = React.useState(initialFilters.status ?? "all_non_archived");
  const [previewQuestion, setPreviewQuestion] = React.useState<QuestionRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<QuestionRecord | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  function applyFilters(nextPage = 1) {
    const params = new URLSearchParams();
    if (subjectId) params.set("subjectId", subjectId);
    if (questionType) params.set("questionType", questionType);
    if (difficulty) params.set("difficulty", difficulty);
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(qs ? `/teacher/questions?${qs}` : "/teacher/questions");
  }

  async function handleDuplicate(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/teacher/questions/${id}/duplicate`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "Gagal menduplikasi soal.");
        return;
      }
      router.refresh();
    } catch {
      setActionError("Gagal menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmArchive() {
    if (!archiveTarget) return;
    setActionError(null);
    setBusyId(archiveTarget.id);
    try {
      const res = await fetch(`/api/teacher/questions/${archiveTarget.id}/archive`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionError(data.error ?? "Gagal mengarsipkan soal.");
        return;
      }
      setArchiveTarget(null);
      router.refresh();
    } catch {
      setActionError("Gagal menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {actionError ? <Alert variant="danger">{actionError}</Alert> : null}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              aria-label="Cari soal berdasarkan pertanyaan, topik, atau tag"
              placeholder="Cari pertanyaan, topik, atau tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters(1)}
              className="pl-9"
            />
          </div>

          <Select
            aria-label="Filter mata pelajaran"
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

          <Select
            aria-label="Filter tipe soal"
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value)}
          >
            <option value="">Semua Tipe Soal</option>
            <option value="single_choice">Pilihan Ganda</option>
            <option value="multiple_choice">Pilihan Jamak</option>
            <option value="true_false">Benar / Salah</option>
            <option value="essay">Esai</option>
          </Select>

          <div className="grid grid-cols-2 gap-2">
            <Select
              aria-label="Filter tingkat kesulitan"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="">Kesulitan</option>
              <option value="easy">Mudah</option>
              <option value="medium">Sedang</option>
              <option value="hard">Sulit</option>
            </Select>

            <Select
              aria-label="Filter status soal"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all_non_archived">Aktif &amp; Draf</option>
              <option value="active">Aktif</option>
              <option value="draft">Draf</option>
              <option value="archived">Arsip</option>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => applyFilters(1)}>
              Terapkan Filter
            </Button>
            <span className="self-center text-xs text-slate-500">
              Menampilkan {initialQuestions.length} dari {total} soal
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/questions/import">
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                <span>Impor CSV / XLSX</span>
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/teacher/questions/new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Buat Soal</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {initialQuestions.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Belum Ada Soal Sesuai Kriteria"
          description={
            authorizedSubjects.length === 0
              ? "Anda belum ditetapkan pada mata pelajaran apa pun. Hubungi administrator sekolah untuk penetapan mata pelajaran."
              : "Mulai buat soal baru atau impor soal secara massal menggunakan templat CSV/XLSX."
          }
          action={
            authorizedSubjects.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/teacher/questions/new">Buat Soal Pertama</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/teacher/questions/import">Impor dari CSV/XLSX</Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile Question Cards View (< md) */}
          <div className="space-y-3 md:hidden">
            {initialQuestions.map((q) => {
              const ver = q.current_version;
              const statusMeta = STATUS_LABELS[q.status];
              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-blue-700">
                        {q.subject_name ?? "-"}
                      </span>
                      <p className="text-xs text-slate-500">{TYPE_LABELS[q.question_type]}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="neutral" className="text-[10px]">
                        {DIFFICULTY_LABELS[q.difficulty]}
                      </Badge>
                      <Badge variant={statusMeta.variant} className="text-[10px]">
                        {statusMeta.label}
                      </Badge>
                    </div>
                  </div>

                  <div className="line-clamp-2 text-sm font-medium text-slate-900">
                    {ver?.stem ?? "-"}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{ver?.points ?? 0} poin</span>
                    <span>•</span>
                    <span>v{ver?.version_number ?? 1}</span>
                    {q.topic ? (
                      <>
                        <span>•</span>
                        <span className="truncate">Topik: {q.topic}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-[40px] px-2.5"
                      aria-label="Pratinjau soal"
                      onClick={() => setPreviewQuestion(q)}
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="min-h-[40px] px-3 font-semibold"
                    >
                      <Link href={`/teacher/questions/${q.id}`}>
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[40px] px-2.5"
                      disabled={busyId === q.id}
                      aria-label="Duplikasi soal"
                      onClick={() => handleDuplicate(q.id)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    {q.status !== "archived" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[40px] px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        disabled={busyId === q.id}
                        aria-label="Arsipkan soal"
                        onClick={() => setArchiveTarget(q)}
                      >
                        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Question Table (>= md) */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pertanyaan &amp; Topik</TableHead>
                  <TableHead>Mapel &amp; Tipe</TableHead>
                  <TableHead>Kesulitan</TableHead>
                  <TableHead>Poin &amp; Versi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialQuestions.map((q) => {
                  const ver = q.current_version;
                  const statusMeta = STATUS_LABELS[q.status];
                  return (
                    <TableRow key={q.id}>
                      <TableCell className="max-w-md">
                        <div className="line-clamp-2 text-sm font-medium text-slate-900">
                          {ver?.stem ?? "-"}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          {q.topic ? <span>Topik: {q.topic}</span> : null}
                          {q.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="neutral" className="text-[10px] px-1.5 py-0">
                              #{tag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-semibold text-slate-800">{q.subject_name ?? "-"}</div>
                        <div className="text-slate-500">{TYPE_LABELS[q.question_type]}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral">{DIFFICULTY_LABELS[q.difficulty]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>{ver?.points ?? 0} poin</div>
                        <div className="text-slate-500">v{ver?.version_number ?? 1}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Pratinjau soal"
                            onClick={() => setPreviewQuestion(q)}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/teacher/questions/${q.id}`}>
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Edit</span>
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busyId === q.id}
                            aria-label="Duplikasi soal"
                            onClick={() => handleDuplicate(q.id)}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          {q.status !== "archived" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busyId === q.id}
                              aria-label="Arsipkan soal"
                              onClick={() => setArchiveTarget(q)}
                            >
                              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
          <span className="text-slate-600">
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => applyFilters(page - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => applyFilters(page + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      ) : null}

      {/* Question Preview Dialog */}
      <Dialog open={Boolean(previewQuestion)} onOpenChange={(o) => !o && setPreviewQuestion(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pratinjau Soal</DialogTitle>
            <DialogDescription>
              {previewQuestion ? TYPE_LABELS[previewQuestion.question_type] : ""} •{" "}
              {previewQuestion?.current_version?.points ?? 0} poin
            </DialogDescription>
          </DialogHeader>
          {previewQuestion?.current_version ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <QuestionContentRenderer content={previewQuestion.current_version.stem} />
              </div>

              {previewQuestion.current_version.options.length > 0 ? (
                <div className="space-y-2">
                  {previewQuestion.current_version.options.map((opt) => {
                    const isCorrect =
                      previewQuestion.current_version?.correct_option_keys.includes(opt.optionKey);
                    return (
                      <div
                        key={opt.optionKey}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                          isCorrect
                            ? "border-emerald-300 bg-emerald-50/70"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <span className="font-mono font-semibold text-slate-700">
                          {opt.optionKey}.
                        </span>
                        <div className="flex-1">
                          <QuestionContentRenderer content={opt.optionText} />
                        </div>
                        {isCorrect ? <Badge variant="success">Kunci</Badge> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Alert variant="info">
                  Soal Esai — siswa akan mengisi jawaban uraian dan dinilai manual oleh guru.
                </Alert>
              )}

              {previewQuestion.current_version.explanation ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-blue-900">Pembahasan:</p>
                  <QuestionContentRenderer content={previewQuestion.current_version.explanation} />
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={Boolean(archiveTarget)} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arsipkan Soal?</DialogTitle>
            <DialogDescription>
              Soal yang diarsipkan tidak dapat ditambahkan ke draf ujian baru, namun salinan ujian
              yang sudah diterbitkan tetap aman dan tidak berubah.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setArchiveTarget(null)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busyId === archiveTarget?.id}
              onClick={handleConfirmArchive}
            >
              Ya, Arsipkan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
