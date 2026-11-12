"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Eye,
  History,
  Loader2,
  Lock,
  Plus,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import type { AcademicYearRecord } from "@/domain/academic/types";
import type {
  ExamClassAssignmentItem,
  ExamDraftQuestionItem,
  ExamPublicationEventItem,
  ExamRecord,
  ExamScheduleItem,
  ExamVersionSummary,
  QuestionRecord,
} from "@/domain/exams/phase2-types";
import {
  isExamEditable,
  type ExamReadinessValidation,
  type ScheduleConflictWarning,
} from "@/domain/exams/exam-lifecycle";
import { formatDateTimeId } from "@/lib/utils";
import type { ExamSecurityPolicyRecord } from "@/domain/monitoring/phase4-types";
import { createDefaultSecurityPolicy } from "@/domain/monitoring/phase4-types";
import { ExamSecurityPolicyPanel } from "@/components/features/monitoring/exam-security-policy-panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EXAM_STATUS_META } from "@/components/features/teacher/exams-list";

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function ExamWorkspace({
  initialExam,
  initialDraftQuestions,
  initialAssignments,
  initialSchedules,
  initialPublishedVersions,
  initialPublicationEvents,
  initialReadiness,
  initialConflicts,
  availableBankQuestions,
  authorizedClasses,
  academicYears,
  timeZone,
  initialSecurityPolicy = null,
}: {
  initialExam: ExamRecord;
  initialDraftQuestions: ExamDraftQuestionItem[];
  initialAssignments: ExamClassAssignmentItem[];
  initialSchedules: ExamScheduleItem[];
  initialPublishedVersions: ExamVersionSummary[];
  initialPublicationEvents: ExamPublicationEventItem[];
  initialReadiness: ExamReadinessValidation;
  initialConflicts: ScheduleConflictWarning[];
  availableBankQuestions: QuestionRecord[];
  authorizedClasses: Array<{ id: string; name: string; grade_level: string; academic_year_id: string }>;
  academicYears: AcademicYearRecord[];
  timeZone: string;
  initialSecurityPolicy?: ExamSecurityPolicyRecord | null;
}) {
  const router = useRouter();
  const editable = isExamEditable(initialExam.status);
  const statusMeta = EXAM_STATUS_META[initialExam.status];

  const [versionLock, setVersionLock] = React.useState(initialExam.version_lock);
  const [syncedPropVersionLock, setSyncedPropVersionLock] = React.useState(
    initialExam.version_lock
  );
  if (initialExam.version_lock !== syncedPropVersionLock) {
    setSyncedPropVersionLock(initialExam.version_lock);
    setVersionLock(initialExam.version_lock);
  }
  const [busy, setBusy] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false);
  const [publishNotes, setPublishNotes] = React.useState("");

  // Config state
  const [title, setTitle] = React.useState(initialExam.title);
  const [academicYearId, setAcademicYearId] = React.useState(initialExam.academic_year_id);
  const [description, setDescription] = React.useState(initialExam.description ?? "");
  const [instructions, setInstructions] = React.useState(initialExam.instructions ?? "");
  const [durationMinutes, setDurationMinutes] = React.useState(String(initialExam.duration_minutes));
  const [maxAttempts, setMaxAttempts] = React.useState(String(initialExam.max_attempts));
  const [passingScore, setPassingScore] = React.useState(String(initialExam.passing_score));
  const [randomizeQuestions, setRandomizeQuestions] = React.useState(initialExam.randomize_questions);
  const [randomizeOptions, setRandomizeOptions] = React.useState(initialExam.randomize_options);
  const [resultReleasePolicy, setResultReleasePolicy] = React.useState<
    "manual" | "after_submit_if_no_essay" | "after_window_close"
  >(initialExam.result_release_policy ?? "manual");

  // Draft question selection state
  const [selectedQuestions, setSelectedQuestions] = React.useState<
    Array<{
      question: QuestionRecord;
      pointsOverride: string;
      preserveOrder: boolean;
    }>
  >(
    initialDraftQuestions.map((dq) => ({
      question: dq.question,
      pointsOverride: dq.points_override !== null ? String(dq.points_override) : "",
      preserveOrder: dq.preserve_order,
    }))
  );
  const [bankSearch, setBankSearch] = React.useState("");

  // Schedule state
  const [selectedClassIds, setSelectedClassIds] = React.useState<string[]>(
    initialAssignments.map((a) => a.class_id)
  );
  const [startsAtLocal, setStartsAtLocal] = React.useState(
    toDatetimeLocalValue(initialExam.starts_at)
  );
  const [endsAtLocal, setEndsAtLocal] = React.useState(toDatetimeLocalValue(initialExam.ends_at));
  const [lateJoinMinutes, setLateJoinMinutes] = React.useState(
    String(initialSchedules[0]?.late_join_minutes ?? 15)
  );
  const [requireExamBrowser, setRequireExamBrowser] = React.useState(
    initialSchedules[0]?.require_exam_browser ?? true
  );

  const selectedIdsSet = new Set(selectedQuestions.map((s) => s.question.id));
  const filteredBank = availableBankQuestions.filter((q) => {
    if (q.status === "archived" || selectedIdsSet.has(q.id)) return false;
    const term = bankSearch.trim().toLowerCase();
    if (!term) return true;
    return (
      (q.current_version?.stem ?? "").toLowerCase().includes(term) ||
      (q.topic ?? "").toLowerCase().includes(term) ||
      q.tags.some((t) => t.toLowerCase().includes(term))
    );
  });

  const liveTotalPoints = selectedQuestions.reduce((sum, item) => {
    const override = item.pointsOverride ? Number(item.pointsOverride) : null;
    const base = item.question.current_version?.points ?? 0;
    return sum + (override && override > 0 ? override : base);
  }, 0);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          subjectId: initialExam.subject_id,
          academicYearId,
          description: description || null,
          instructions: instructions || null,
          durationMinutes: Number(durationMinutes),
          maxAttempts: Number(maxAttempts),
          passingScore: Number(passingScore),
          randomizeQuestions,
          randomizeOptions,
          resultReleasePolicy,
          startsAt: startsAtLocal ? new Date(startsAtLocal).toISOString() : null,
          endsAt: endsAtLocal ? new Date(endsAtLocal).toISOString() : null,
          versionLock,
        }),
      });
      const data = (await res.json()) as { error?: string; versionLock?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal memperbarui konfigurasi ujian.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setSuccessMessage("Konfigurasi ujian berhasil disimpan.");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSelectedQuestions() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionLock,
          items: selectedQuestions.map((item) => ({
            questionId: item.question.id,
            pointsOverride:
              item.pointsOverride && Number(item.pointsOverride) > 0
                ? Number(item.pointsOverride)
                : null,
            preserveOrder: item.preserveOrder,
          })),
        }),
      });
      const data = (await res.json()) as { error?: string; versionLock?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal menyimpan daftar soal ujian.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setSuccessMessage("Susunan soal ujian berhasil diperbarui.");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!startsAtLocal || !endsAtLocal) {
      setErrorMessage("Waktu mulai dan waktu selesai wajib diisi.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionLock,
          startsAt: new Date(startsAtLocal).toISOString(),
          endsAt: new Date(endsAtLocal).toISOString(),
          durationMinutes: Number(durationMinutes),
          maxAttempts: Number(maxAttempts),
          lateJoinMinutes: Number(lateJoinMinutes),
          requireExamBrowser,
          classIds: selectedClassIds,
        }),
      });
      const data = (await res.json()) as { error?: string; versionLock?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal menyimpan jadwal ujian.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setSuccessMessage("Jadwal dan kelas peserta berhasil disimpan.");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionLock }),
      });
      const data = (await res.json()) as {
        error?: string;
        versionLock?: number;
        readiness?: ExamReadinessValidation;
      };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Validasi ujian gagal.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      if (data.readiness?.ready) {
        setSuccessMessage("Ujian lolos validasi dan berstatus Siap Tinjau.");
      } else {
        setErrorMessage("Masih terdapat butir kelengkapan yang belum terpenuhi.");
      }
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAtomicPublish() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionLock, notes: publishNotes || null }),
      });
      const data = (await res.json()) as {
        error?: string;
        versionNumber?: number;
        versionLock?: number;
      };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal menerbitkan ujian.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setPublishDialogOpen(false);
      setPublishNotes("");
      setSuccessMessage(
        `Ujian berhasil diterbitkan sebagai versi imutabel v${data.versionNumber ?? 1}.`
      );
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartRevision() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionLock,
          notes: "Membuka draf revisi baru tanpa mengubah versi terpublikasi sebelumnya.",
        }),
      });
      const data = (await res.json()) as { error?: string; versionLock?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal membuka revisi baru.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setSuccessMessage("Mode revisi draf dibuka. Versi terpublikasi sebelumnya tetap aman.");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLifecycleTransition(targetStatus: "CLOSED" | "ARCHIVED") {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/teacher/exams/${initialExam.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionLock, targetStatus }),
      });
      const data = (await res.json()) as { error?: string; versionLock?: number };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal mengubah status ujian.");
        return;
      }
      if (data.versionLock) setVersionLock(data.versionLock);
      setSuccessMessage(`Status ujian diperbarui menjadi ${targetStatus}.`);
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= selectedQuestions.length) return;
    const copy = [...selectedQuestions];
    const tmp = copy[index]!;
    copy[index] = copy[nextIdx]!;
    copy[nextIdx] = tmp;
    setSelectedQuestions(copy);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/exams">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Daftar Ujian</span>
            </Link>
          </Button>
          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
          <span className="font-mono text-xs text-slate-500">
            {initialExam.subject_code} • {selectedQuestions.length} soal • {liveTotalPoints} poin
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {initialExam.status === "PUBLISHED" || initialExam.status === "CLOSED" ? (
            <Button asChild size="sm">
              <Link href={`/teacher/exams/${initialExam.id}/grading`}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>Penilaian &amp; Hasil</span>
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href={`/teacher/exams/${initialExam.id}/preview`}>
              <Eye className="h-4 w-4" aria-hidden="true" />
              <span>Pratinjau Siswa</span>
            </Link>
          </Button>
        </div>
      </div>

      {!editable ? (
        <Alert variant="info" title="Versi Terkunci (Imutabel)">
          Ujian ini berstatus <strong>{statusMeta.label}</strong>. Soal dan konfigurasi versi yang
          sudah diterbitkan tidak dapat diubah diam-diam.
        </Alert>
      ) : null}

      {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}
      {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="config">1. Konfigurasi</TabsTrigger>
          <TabsTrigger value="questions">2. Pemilihan Soal ({selectedQuestions.length})</TabsTrigger>
          <TabsTrigger value="schedule">3. Jadwal &amp; Kelas ({selectedClassIds.length})</TabsTrigger>
          <TabsTrigger value="publish">4. Validasi &amp; Publikasi</TabsTrigger>
          <TabsTrigger value="history">
            5. Riwayat Versi ({initialPublishedVersions.length})
          </TabsTrigger>
          <TabsTrigger value="security">6. Keamanan &amp; SEB</TabsTrigger>
        </TabsList>

        {/* Tab 1: Config */}
        <TabsContent value="config">
          <form onSubmit={saveConfig}>
            <Card>
              <CardHeader>
                <CardTitle>Konfigurasi Umum Ujian</CardTitle>
                <CardDescription>
                  Atur durasi, batas percobaan, KKM, pengacakan, dan petunjuk pengerjaan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ew-title">Judul Ujian</Label>
                  <Input
                    id="ew-title"
                    value={title}
                    disabled={!editable}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ew-year">Tahun Ajaran</Label>
                  <Select
                    id="ew-year"
                    value={academicYearId}
                    disabled={!editable}
                    onChange={(e) => setAcademicYearId(e.target.value)}
                  >
                    {academicYears.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.name} ({y.semester})
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ew-dur">Durasi (m)</Label>
                    <Input
                      id="ew-dur"
                      type="number"
                      min={1}
                      max={480}
                      disabled={!editable}
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ew-att">Maks. Coba</Label>
                    <Input
                      id="ew-att"
                      type="number"
                      min={1}
                      max={10}
                      disabled={!editable}
                      value={maxAttempts}
                      onChange={(e) => setMaxAttempts(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ew-pass">KKM</Label>
                    <Input
                      id="ew-pass"
                      type="number"
                      min={0}
                      step="0.5"
                      disabled={!editable}
                      value={passingScore}
                      onChange={(e) => setPassingScore(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ew-desc">Deskripsi</Label>
                  <Textarea
                    id="ew-desc"
                    rows={2}
                    disabled={!editable}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ew-inst">Petunjuk Siswa</Label>
                  <Textarea
                    id="ew-inst"
                    rows={3}
                    disabled={!editable}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={randomizeQuestions}
                      onChange={(e) => setRandomizeQuestions(e.target.checked)}
                    />
                    <span>Acak urutan soal per percobaan siswa</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={randomizeOptions}
                      onChange={(e) => setRandomizeOptions(e.target.checked)}
                    />
                    <span>Acak urutan pilihan jawaban</span>
                  </label>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ew-release-policy">Kebijakan Rilis Nilai Siswa</Label>
                  <Select
                    id="ew-release-policy"
                    disabled={!editable}
                    value={resultReleasePolicy}
                    onChange={(e) =>
                      setResultReleasePolicy(
                        e.target.value as
                          | "manual"
                          | "after_submit_if_no_essay"
                          | "after_window_close"
                      )
                    }
                  >
                    <option value="manual">Manual — Guru merilis hasil secara eksplisit</option>
                    <option value="after_submit_if_no_essay">
                      Otomatis setelah kumpul (jika tanpa esai)
                    </option>
                    <option value="after_window_close">
                      Otomatis setelah jendela ujian berakhir
                    </option>
                  </Select>
                </div>

                {editable ? (
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span>Simpan Konfigurasi</span>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </form>
        </TabsContent>

        {/* Tab 2: Question Picker & Reordering */}
        <TabsContent value="questions" className="space-y-5">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Selected questions */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle>Soal Terpilih ({selectedQuestions.length})</CardTitle>
                  <CardDescription>Total Poin: {liveTotalPoints}</CardDescription>
                </div>
                {editable ? (
                  <Button type="button" size="sm" disabled={busy} onClick={saveSelectedQuestions}>
                    <Save className="h-4 w-4" aria-hidden="true" />
                    <span>Simpan Susunan</span>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-2.5">
                {selectedQuestions.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Belum ada soal dipilih. Pilih soal dari panel Bank Soal di sebelah kanan.
                  </p>
                ) : (
                  selectedQuestions.map((item, idx) => (
                    <div
                      key={item.question.id}
                      className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="mr-2 font-mono text-xs font-bold text-blue-800">
                            #{idx + 1}
                          </span>
                          <span className="font-medium text-slate-900">
                            {item.question.current_version?.stem ?? "-"}
                          </span>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.question.question_type} • Standar:{" "}
                            {item.question.current_version?.points ?? 0} poin
                            {item.question.status === "archived" ? (
                              <span className="ml-2 font-semibold text-red-700">
                                (Diarsipkan — hapus sebelum terbit!)
                              </span>
                            ) : null}
                          </p>
                        </div>

                        {editable ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={idx === 0}
                              aria-label="Naikkan urutan soal"
                              onClick={() => moveQuestion(idx, -1)}
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={idx === selectedQuestions.length - 1}
                              aria-label="Turunkan urutan soal"
                              onClick={() => moveQuestion(idx, 1)}
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label="Hapus soal dari draf"
                              onClick={() =>
                                setSelectedQuestions((prev) =>
                                  prev.filter((q) => q.question.id !== item.question.id)
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      {editable ? (
                        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-2 text-xs">
                          <label className="flex items-center gap-1.5">
                            <span className="text-slate-600">Override Poin:</span>
                            <Input
                              type="number"
                              step="0.5"
                              min="0.5"
                              placeholder={String(item.question.current_version?.points ?? 1)}
                              value={item.pointsOverride}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedQuestions((prev) =>
                                  prev.map((q, i) =>
                                    i === idx ? { ...q, pointsOverride: val } : q
                                  )
                                );
                              }}
                              className="min-h-[32px] w-20 px-2 py-1 text-xs"
                            />
                          </label>

                          <label className="flex items-center gap-1.5 text-slate-700">
                            <input
                              type="checkbox"
                              checked={item.preserveOrder}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedQuestions((prev) =>
                                  prev.map((q, i) =>
                                    i === idx ? { ...q, preserveOrder: checked } : q
                                  )
                                );
                              }}
                            />
                            <span>Kunci posisi soal</span>
                          </label>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Available bank questions */}
            <Card>
              <CardHeader>
                <CardTitle>Bank Soal ({initialExam.subject_name})</CardTitle>
                <CardDescription>
                  Pilih soal yang sesuai mata pelajaran tanpa menduplikasi data bank soal.
                </CardDescription>
                <Input
                  aria-label="Cari soal di bank"
                  placeholder="Cari pertanyaan, topik, atau tag..."
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  className="mt-2"
                />
              </CardHeader>
              <CardContent className="max-h-[520px] space-y-2.5 overflow-y-auto">
                {filteredBank.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Tidak ada soal lain yang tersedia untuk mata pelajaran ini.{" "}
                    <Link href="/teacher/questions/new" className="text-blue-700 underline">
                      Buat soal baru
                    </Link>
                    .
                  </p>
                ) : (
                  filteredBank.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-medium text-slate-900">
                          {q.current_version?.stem ?? "-"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {q.question_type} • {q.difficulty} • {q.current_version?.points ?? 0} poin
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!editable}
                        onClick={() =>
                          setSelectedQuestions((prev) => [
                            ...prev,
                            { question: q, pointsOverride: "", preserveOrder: false },
                          ])
                        }
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Tambah</span>
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 3: Schedule & Classes */}
        <TabsContent value="schedule">
          <form onSubmit={saveSchedule} className="space-y-4">
            {initialConflicts.length > 0 ? (
              <Alert variant="warning" title="Peringatan Konflik Jadwal Kelas">
                <ul className="list-disc pl-5 space-y-1">
                  {initialConflicts.map((c) => (
                    <li key={`${c.classId}-${c.conflictingExamId}`}>
                      Kelas <strong>{c.className}</strong> bertumpukan dengan{" "}
                      <strong>{c.conflictingExamTitle}</strong> (
                      {formatDateTimeId(c.startsAt, timeZone)} —{" "}
                      {formatDateTimeId(c.endsAt, timeZone)})
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>Jadwal Pelaksanaan &amp; Kelas Peserta</CardTitle>
                <CardDescription>
                  Semua stempel waktu ditampilkan dalam zona waktu sekolah ({timeZone}) dan
                  disimpan secara otoritatif di server.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="es-start">Waktu Mulai Tersedia</Label>
                  <Input
                    id="es-start"
                    type="datetime-local"
                    disabled={!editable}
                    value={startsAtLocal}
                    onChange={(e) => setStartsAtLocal(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="es-end">Waktu Berakhir Jendela Ujian</Label>
                  <Input
                    id="es-end"
                    type="datetime-local"
                    disabled={!editable}
                    value={endsAtLocal}
                    onChange={(e) => setEndsAtLocal(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="es-late">Batas Keterlambatan Masuk (Menit)</Label>
                  <Input
                    id="es-late"
                    type="number"
                    min={0}
                    max={120}
                    disabled={!editable}
                    value={lateJoinMinutes}
                    onChange={(e) => setLateJoinMinutes(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="es-eb"
                    type="checkbox"
                    disabled={!editable}
                    checked={requireExamBrowser}
                    onChange={(e) => setRequireExamBrowser(e.target.checked)}
                  />
                  <Label htmlFor="es-eb">
                    Wajibkan ExamBro (Android) / Safe Exam Browser (iOS)
                  </Label>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Kelas Peserta ({selectedClassIds.length} dipilih)</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {authorizedClasses.map((cls) => (
                      <label
                        key={cls.id}
                        className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={selectedClassIds.includes(cls.id)}
                          onChange={() =>
                            setSelectedClassIds((prev) =>
                              prev.includes(cls.id)
                                ? prev.filter((id) => id !== cls.id)
                                : [...prev, cls.id]
                            )
                          }
                        />
                        <span>{cls.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {editable ? (
                  <div className="flex justify-end sm:col-span-2">
                    <Button type="submit" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span>Simpan Jadwal &amp; Kelas</span>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </form>
        </TabsContent>

        {/* Tab 4: Validation & Publish */}
        <TabsContent value="publish" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Daftar Periksa Kesiapan Ujian</CardTitle>
              <CardDescription>
                Simpan perubahan soal dan jadwal terlebih dahulu sebelum menjalankan validasi dan
                publikasi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {initialReadiness.checklist.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
                    item.passed
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-amber-200 bg-amber-50/40"
                  }`}
                >
                  {item.passed ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  )}
                  <div>
                    <p className="font-semibold text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-600">{item.detail}</p>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                {editable ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={handleValidate}>
                      Validasi Ujian
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !initialReadiness.ready}
                      onClick={() => setPublishDialogOpen(true)}
                    >
                      <Rocket className="h-4 w-4" aria-hidden="true" />
                      <span>Terbitkan Versi Imutabel</span>
                    </Button>
                  </>
                ) : null}

                {initialExam.status === "PUBLISHED" ? (
                  <>
                    <Button type="button" variant="outline" disabled={busy} onClick={handleStartRevision}>
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      <span>Buka Revisi Baru (v+1)</span>
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => handleLifecycleTransition("CLOSED")}
                    >
                      Tutup Ujian
                    </Button>
                  </>
                ) : null}

                {initialExam.status === "CLOSED" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => handleLifecycleTransition("ARCHIVED")}
                  >
                    Arsipkan Ujian
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: Versions & Events */}
        <TabsContent value="history" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Snapshot Versi Terpublikasi (Imutabel)</CardTitle>
              <CardDescription>
                Setiap versi yang diterbitkan menyimpan salinan soal, opsi, bobot poin, dan hash
                integritas yang tidak dapat diubah diam-diam.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {initialPublishedVersions.length === 0 ? (
                <p className="text-sm text-slate-600">Ujian ini belum pernah diterbitkan.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Versi</TableHead>
                      <TableHead>Soal &amp; Poin</TableHead>
                      <TableHead>Diterbitkan</TableHead>
                      <TableHead>Hash Snapshot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {initialPublishedVersions.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-mono font-semibold">v{v.version_number}</TableCell>
                        <TableCell className="text-xs">
                          {v.question_count ?? 0} soal • {v.total_points} poin
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          <div>{v.published_by_name ?? "Guru"}</div>
                          <div>{formatDateTimeId(v.published_at, timeZone)}</div>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-500">
                          {v.snapshot_hash.slice(0, 16)}...
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <CardTitle>Log Publikasi &amp; Siklus Hidup</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {initialPublicationEvents.length === 0 ? (
                <p className="text-sm text-slate-600">Belum ada catatan kejadian publikasi.</p>
              ) : (
                <div className="divide-y divide-slate-200 text-sm">
                  {initialPublicationEvents.map((ev) => (
                    <div key={ev.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between">
                      <div>
                        <Badge variant="neutral" className="mr-2 font-mono text-[11px]">
                          {ev.event_type}
                        </Badge>
                        <span className="font-medium text-slate-900">
                          {ev.actor_name ?? "Pengguna"}
                        </span>
                        {ev.notes ? <p className="mt-1 text-xs text-slate-600">{ev.notes}</p> : null}
                      </div>
                      <span className="text-xs text-slate-500">
                        {formatDateTimeId(ev.created_at, timeZone)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 6: Security & Browser Policy */}
        <TabsContent value="security" className="space-y-5">
          <ExamSecurityPolicyPanel
            examId={initialExam.id}
            initialPolicy={
              initialSecurityPolicy ??
              createDefaultSecurityPolicy({
                examId: initialExam.id,
                schoolId: initialExam.school_id,
              })
            }
          />
        </TabsContent>
      </Tabs>

      {/* Atomic Publish Confirmation Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Konfirmasi Publikasi Ujian</DialogTitle>
            <DialogDescription>
              Menerbitkan ujian akan membuat snapshot imutabel dari {selectedQuestions.length} soal
              dan mengunci penyuntingan langsung.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="pub-notes">Catatan Publikasi (Opsional)</Label>
            <Textarea
              id="pub-notes"
              placeholder="Mis. Versi final siap untuk PTS Semester Ganjil."
              value={publishNotes}
              onChange={(e) => setPublishNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Batal
            </Button>
            <Button type="button" disabled={busy} onClick={handleAtomicPublish}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              <span>Ya, Terbitkan Sekarang</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
