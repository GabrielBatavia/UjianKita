"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  EyeOff,
  Loader2,
  Rocket,
  Save,
  Search,
} from "lucide-react";
import type { ExamRecord } from "@/domain/exams/phase2-types";
import type {
  TeacherAttemptDetailPayload,
  TeacherGradingAttemptSummary,
} from "@/domain/exams/phase3-types";
import { formatDateTimeId } from "@/lib/utils";
import { QuestionContentRenderer } from "@/components/features/exams/question-content-renderer";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";

const ATTEMPT_STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "danger" | "neutral" | "default" }
> = {
  IN_PROGRESS: { label: "Sedang Dikerjakan", variant: "warning" },
  SUBMITTING: { label: "Mengumpulkan", variant: "default" },
  SUBMITTED: { label: "Dikumpulkan", variant: "success" },
  EXPIRED: { label: "Waktu Habis", variant: "warning" },
  CANCELLED_BY_ADMIN: { label: "Dibatalkan Admin", variant: "danger" },
};

const GRADING_STATUS_BADGE: Record<
  string,
  { label: string; variant: "success" | "warning" | "default" | "neutral" }
> = {
  PENDING_OBJECTIVE: { label: "Proses Otomatis", variant: "neutral" },
  PENDING_MANUAL_REVIEW: { label: "Perlu Nilai Esai", variant: "warning" },
  GRADED: { label: "Sudah Dinilai", variant: "success" },
  ADJUSTED: { label: "Disesuaikan", variant: "default" },
};

export function TeacherGradingWorkspace({
  exam,
  initialAttempts,
  timeZone,
}: {
  exam: ExamRecord;
  initialAttempts: TeacherGradingAttemptSummary[];
  timeZone: string;
}) {
  const router = useRouter();
  const [attempts, setAttempts] = React.useState<TeacherGradingAttemptSummary[]>(initialAttempts);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const [selectedAttemptId, setSelectedAttemptId] = React.useState<string | null>(
    initialAttempts[0]?.attemptId ?? null
  );
  const [attemptDetail, setAttemptDetail] = React.useState<TeacherAttemptDetailPayload | null>(
    null
  );
  const [loadingDetail, setLoadingDetail] = React.useState(() =>
    Boolean(initialAttempts[0]?.attemptId)
  );

  const [essayInputs, setEssayInputs] = React.useState<
    Record<string, { score: string; feedback: string }>
  >({});
  const [adjustNewScore, setAdjustNewScore] = React.useState("");
  const [adjustReason, setAdjustReason] = React.useState("");

  const [busyAction, setBusyAction] = React.useState(false);
  const [feedbackBanner, setFeedbackBanner] = React.useState<{
    type: "success" | "danger";
    message: string;
  } | null>(null);

  const applyAttemptDetail = React.useCallback((data: TeacherAttemptDetailPayload) => {
    setAttemptDetail(data);
    const initialEssayState: Record<string, { score: string; feedback: string }> = {};
    for (const q of data.questions) {
      if (q.questionType === "essay" || q.scoringPolicy === "manual_rubric") {
        initialEssayState[q.examVersionQuestionId] = {
          score: q.manualEntry ? String(q.manualEntry.assignedScore) : "0",
          feedback: q.manualEntry?.feedback ?? "",
        };
      }
    }
    setEssayInputs(initialEssayState);
    setAdjustNewScore(data.summary.totalScore !== null ? String(data.summary.totalScore) : "");
    setAdjustReason("");
  }, []);

  const loadAttemptDetail = React.useCallback(
    async (attemptId: string) => {
      setLoadingDetail(true);
      setAttemptDetail(null);
      try {
        const res = await fetch(`/api/teacher/attempts/${attemptId}`, { cache: "no-store" });
        if (!res.ok) {
          setFeedbackBanner({ type: "danger", message: "Gagal memuat detail jawaban peserta." });
          return;
        }
        const data = (await res.json()) as TeacherAttemptDetailPayload;
        applyAttemptDetail(data);
      } catch {
        setFeedbackBanner({ type: "danger", message: "Gagal terhubung ke server." });
      } finally {
        setLoadingDetail(false);
      }
    },
    [applyAttemptDetail]
  );

  React.useEffect(() => {
    if (!selectedAttemptId) return;
    let cancelled = false;

    void fetch(`/api/teacher/attempts/${selectedAttemptId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) {
            setFeedbackBanner({ type: "danger", message: "Gagal memuat detail jawaban peserta." });
          }
          return;
        }
        const data = (await res.json()) as TeacherAttemptDetailPayload;
        if (!cancelled) {
          applyAttemptDetail(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFeedbackBanner({ type: "danger", message: "Gagal terhubung ke server." });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAttemptId, applyAttemptDetail]);

  const refreshAttemptList = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/teacher/exams/${exam.id}/attempts`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { attempts: TeacherGradingAttemptSummary[] };
      setAttempts(data.attempts);
    } catch {
      // ignore transient error
    }
  }, [exam.id]);

  async function handleSaveManualEssays(releaseIfComplete: boolean) {
    if (!attemptDetail) return;
    setFeedbackBanner(null);
    setBusyAction(true);
    try {
      const entries = Object.entries(essayInputs).map(([evqId, val]) => ({
        examVersionQuestionId: evqId,
        assignedScore: Number(val.score),
        feedback: val.feedback || null,
      }));
      const res = await fetch(`/api/teacher/attempts/${attemptDetail.summary.attemptId}/grade`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, releaseIfComplete }),
      });
      const data = (await res.json()) as { error?: string; totalScore?: number };
      if (!res.ok) {
        setFeedbackBanner({
          type: "danger",
          message: data.error ?? "Gagal menyimpan nilai esai.",
        });
        return;
      }

      setFeedbackBanner({
        type: "success",
        message: releaseIfComplete
          ? `Nilai esai disimpan & dirilis (${data.totalScore} poin).`
          : `Penilaian esai tersimpan (${data.totalScore} poin).`,
      });
      await Promise.all([
        refreshAttemptList(),
        loadAttemptDetail(attemptDetail.summary.attemptId),
      ]);
      router.refresh();
    } catch {
      setFeedbackBanner({ type: "danger", message: "Gagal menghubungi server." });
    } finally {
      setBusyAction(false);
    }
  }

  async function handleAdjustScore(e: React.FormEvent) {
    e.preventDefault();
    if (!attemptDetail) return;
    setFeedbackBanner(null);
    setBusyAction(true);
    try {
      const res = await fetch(`/api/teacher/attempts/${attemptDetail.summary.attemptId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newTotalScore: Number(adjustNewScore),
          reason: adjustReason,
        }),
      });
      const data = (await res.json()) as { error?: string; totalScore?: number };
      if (!res.ok) {
        setFeedbackBanner({
          type: "danger",
          message: data.error ?? "Gagal melakukan penyesuaian nilai.",
        });
        return;
      }

      setFeedbackBanner({
        type: "success",
        message: `Penyesuaian nilai berhasil dicatat (Nilai akhir baru: ${data.totalScore}).`,
      });
      setAdjustReason("");
      await Promise.all([
        refreshAttemptList(),
        loadAttemptDetail(attemptDetail.summary.attemptId),
      ]);
    } catch {
      setFeedbackBanner({ type: "danger", message: "Gagal menghubungi server." });
    } finally {
      setBusyAction(false);
    }
  }

  async function handleReleaseAction(action: "release" | "unpublish") {
    setFeedbackBanner(null);
    setBusyAction(true);
    try {
      const res = await fetch(`/api/teacher/exams/${exam.id}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as {
        error?: string;
        releasedCount?: number;
        pendingManualCount?: number;
        unpublishedCount?: number;
      };
      if (!res.ok) {
        setFeedbackBanner({
          type: "danger",
          message: data.error ?? "Gagal mengubah publikasi hasil ujian.",
        });
        return;
      }

      setFeedbackBanner({
        type: "success",
        message:
          action === "release"
            ? `Berhasil merilis ${data.releasedCount ?? 0} nilai siap publik${
                (data.pendingManualCount ?? 0) > 0
                  ? ` (${data.pendingManualCount} sesi masih menunggu esai)`
                  : "."
              }`
            : `Publikasi ${data.unpublishedCount ?? 0} hasil siswa ditarik kembali.`,
      });
      await refreshAttemptList();
      if (selectedAttemptId) await loadAttemptDetail(selectedAttemptId);
      router.refresh();
    } catch {
      setFeedbackBanner({ type: "danger", message: "Gagal menghubungi server." });
    } finally {
      setBusyAction(false);
    }
  }

  const filteredAttempts = attempts.filter((att) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      att.studentName.toLowerCase().includes(q) ||
      (att.studentNis ?? "").toLowerCase().includes(q) ||
      (att.receiptCode ?? "").toLowerCase().includes(q);

    const matchesStatus =
      statusFilter === "all" ||
      att.gradingStatus === statusFilter ||
      att.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const essayQuestions =
    attemptDetail?.questions.filter(
      (q) => q.questionType === "essay" || q.scoringPolicy === "manual_rubric"
    ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/teacher/exams/${exam.id}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Workspace Ujian</span>
            </Link>
          </Button>
          <Badge variant="default">Kebijakan Rilis: {exam.result_release_policy ?? "manual"}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busyAction}
            onClick={() => void handleReleaseAction("unpublish")}
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" />
            <span>Tarik Rilis</span>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busyAction}
            onClick={() => void handleReleaseAction("release")}
          >
            {busyAction ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Rocket className="h-4 w-4" aria-hidden="true" />
            )}
            <span>Rilis Nilai Siap Publik</span>
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Penilaian &amp; Hasil: {exam.title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {exam.subject_code} — {exam.subject_name} • KKM {exam.passing_score}
        </p>
      </div>

      {feedbackBanner ? (
        <Alert variant={feedbackBanner.type}>{feedbackBanner.message}</Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left: Participant Attempt Roster */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Daftar Sesi Peserta ({attempts.length})</CardTitle>
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Cari nama, NIS, atau bukti..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                aria-label="Filter status penilaian"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">Semua Status</option>
                <option value="PENDING_MANUAL_REVIEW">Perlu Nilai Esai</option>
                <option value="GRADED">Sudah Dinilai</option>
                <option value="ADJUSTED">Disesuaikan</option>
                <option value="IN_PROGRESS">Sedang Dikerjakan</option>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {filteredAttempts.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600">
                Belum ada sesi pengerjaan siswa yang sesuai filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Siswa</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Nilai</TableHead>
                      <TableHead>Rilis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAttempts.map((att) => {
                      const attMeta = ATTEMPT_STATUS_BADGE[att.status] ?? {
                        label: att.status,
                        variant: "neutral" as const,
                      };
                      const grMeta = att.gradingStatus
                        ? GRADING_STATUS_BADGE[att.gradingStatus]
                        : null;
                      const selected = att.attemptId === selectedAttemptId;

                      return (
                        <TableRow
                          key={att.attemptId}
                          onClick={() => {
                            if (att.attemptId !== selectedAttemptId) {
                              setLoadingDetail(true);
                              setAttemptDetail(null);
                              setSelectedAttemptId(att.attemptId);
                            }
                          }}
                          className={`cursor-pointer transition ${
                            selected ? "bg-blue-50/80" : "hover:bg-slate-50"
                          }`}
                        >
                          <TableCell>
                            <p className="font-semibold text-slate-900">{att.studentName}</p>
                            <p className="text-xs text-slate-500">
                              {att.className} {att.studentNis ? `• ${att.studentNis}` : ""} • #
                              {att.attemptNumber}
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant={attMeta.variant}>{attMeta.label}</Badge>
                              {grMeta ? <Badge variant={grMeta.variant}>{grMeta.label}</Badge> : null}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {att.totalScore !== null && att.maxScore !== null ? (
                              <div>
                                <span className="font-bold text-slate-900">
                                  {att.percentageScore?.toFixed(1)}%
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  {att.totalScore}/{att.maxScore}
                                </p>
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={att.releaseStatus === "RELEASED" ? "success" : "neutral"}>
                              {att.releaseStatus === "RELEASED" ? "Dirilis" : "Tertahan"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Attempt Detail & Grading Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <span>Pemeriksaan Jawaban &amp; Penilaian</span>
            </CardTitle>
            <CardDescription>
              Pilih salah satu peserta di daftar kiri untuk menilai esai, menyesuaikan nilai secara
              teraudit, atau memeriksa jejak kejadian.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {!selectedAttemptId ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Belum ada peserta dipilih.
              </p>
            ) : loadingDetail ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Memuat detail jawaban peserta...</span>
              </div>
            ) : attemptDetail ? (
              <>
                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">Peserta</p>
                    <p className="font-semibold text-slate-900">
                      {attemptDetail.summary.studentName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Objektif</p>
                    <p className="font-mono font-bold text-slate-900">
                      {attemptDetail.summary.objectiveScore ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Esai / Manual</p>
                    <p className="font-mono font-bold text-slate-900">
                      {attemptDetail.summary.manualScore ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Nilai Akhir</p>
                    <p className="font-mono font-bold text-slate-900">
                      {attemptDetail.summary.percentageScore?.toFixed(2) ?? "0.00"}% (
                      {attemptDetail.summary.totalScore ?? 0}/{attemptDetail.summary.maxScore ?? 0})
                    </p>
                  </div>
                </div>

                {/* Essay Manual Grading Form */}
                {essayQuestions.length > 0 &&
                (attemptDetail.summary.status === "SUBMITTED" ||
                  attemptDetail.summary.status === "EXPIRED") ? (
                  <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">
                        Penilaian Soal Esai ({essayQuestions.length} butir)
                      </h2>
                      <Badge variant="warning">
                        Belum dinilai: {attemptDetail.summary.pendingEssayCount}
                      </Badge>
                    </div>

                    {essayQuestions.map((q) => {
                      const formVal = essayInputs[q.examVersionQuestionId] ?? {
                        score: "0",
                        feedback: "",
                      };
                      return (
                        <div
                          key={q.examVersionQuestionId}
                          className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-600">
                            <span className="font-semibold">
                              Soal No. {q.displayIndex} • Maks. {q.maxPoints} poin
                            </span>
                            {q.manualEntry ? (
                              <Badge variant="success">Sudah dinilai</Badge>
                            ) : (
                              <Badge variant="warning">Belum dinilai</Badge>
                            )}
                          </div>

                          <div className="text-sm">
                            <QuestionContentRenderer content={q.stem} />
                          </div>

                          {q.rubricNotes ? (
                            <div className="rounded bg-blue-50 p-2.5 text-xs text-blue-900">
                              <strong>Rubrik:</strong> {q.rubricNotes}
                            </div>
                          ) : null}

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <p className="text-xs font-semibold text-slate-500">Jawaban Siswa:</p>
                            <p className="mt-1 whitespace-pre-wrap text-slate-900">
                              {q.studentAnswer?.textAnswer?.trim()
                                ? q.studentAnswer.textAnswer
                                : "(Siswa tidak mengisi jawaban)"}
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                            <div className="space-y-1">
                              <Label htmlFor={`sc-${q.examVersionQuestionId}`}>
                                Skor (0 - {q.maxPoints})
                              </Label>
                              <Input
                                id={`sc-${q.examVersionQuestionId}`}
                                type="number"
                                min={0}
                                max={q.maxPoints}
                                step="0.25"
                                value={formVal.score}
                                onChange={(e) =>
                                  setEssayInputs((prev) => ({
                                    ...prev,
                                    [q.examVersionQuestionId]: {
                                      ...formVal,
                                      score: e.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`fb-${q.examVersionQuestionId}`}>
                                Catatan Umpan Balik (Opsional)
                              </Label>
                              <Input
                                id={`fb-${q.examVersionQuestionId}`}
                                value={formVal.feedback}
                                onChange={(e) =>
                                  setEssayInputs((prev) => ({
                                    ...prev,
                                    [q.examVersionQuestionId]: {
                                      ...formVal,
                                      feedback: e.target.value,
                                    },
                                  }))
                                }
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busyAction}
                        onClick={() => void handleSaveManualEssays(false)}
                      >
                        <Save className="h-4 w-4" aria-hidden="true" />
                        <span>Simpan Nilai Esai</span>
                      </Button>
                      <Button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleSaveManualEssays(true)}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>Simpan &amp; Rilis Hasil Siswa</span>
                      </Button>
                    </div>
                  </div>
                ) : null}

                {/* Audited Post-Grading Score Adjustment */}
                {(attemptDetail.summary.status === "SUBMITTED" ||
                  attemptDetail.summary.status === "EXPIRED") &&
                attemptDetail.summary.pendingEssayCount === 0 ? (
                  <form
                    onSubmit={(e) => void handleAdjustScore(e)}
                    className="space-y-3 rounded-lg border border-slate-200 p-4"
                  >
                    <h3 className="text-sm font-bold text-slate-900">
                      Koreksi / Penyesuaian Nilai Teraudit
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                      <div className="space-y-1">
                        <Label htmlFor="adj-score">
                          Total Skor Baru (0 - {attemptDetail.summary.maxScore ?? 100})
                        </Label>
                        <Input
                          id="adj-score"
                          type="number"
                          min={0}
                          max={attemptDetail.summary.maxScore ?? 1000}
                          step="0.25"
                          value={adjustNewScore}
                          onChange={(e) => setAdjustNewScore(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="adj-reason">Alasan Koreksi (Wajib Audit)</Label>
                        <Textarea
                          id="adj-reason"
                          rows={2}
                          minLength={5}
                          placeholder="Contoh: Pembulatan kompensasi ralat soal nomor 4."
                          value={adjustReason}
                          onChange={(e) => setAdjustReason(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <Button type="submit" size="sm" variant="outline" disabled={busyAction}>
                      Terapkan Penyesuaian Nilai
                    </Button>

                    {attemptDetail.adjustments.length > 0 ? (
                      <div className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                        <p className="font-semibold text-slate-800">Riwayat Penyesuaian:</p>
                        {attemptDetail.adjustments.map((adj) => (
                          <p key={adj.id}>
                            <span className="font-mono">
                              {adj.previousTotalScore} → {adj.newTotalScore}
                            </span>{" "}
                            oleh {adj.adjustedByName ?? "Guru"} — &ldquo;{adj.reason}&rdquo; (
                            {formatDateTimeId(adj.createdAtUtc, timeZone)})
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </form>
                ) : null}

                {/* Compact Question Inspection + Chronological Events */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-900">
                    Rincian Jawaban &amp; Log Aktivitas Sesi
                  </h3>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                    {attemptDetail.questions.map((q) => (
                      <div
                        key={q.attemptQuestionId}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-semibold">No. {q.displayIndex}</span> •{" "}
                          <span className="text-slate-600">{q.questionType}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono">
                          <span>
                            {q.awardedPoints} / {q.maxPoints}
                          </span>
                          {q.isObjectiveCorrect === true ? (
                            <Badge variant="success">Benar</Badge>
                          ) : q.isObjectiveCorrect === false ? (
                            <Badge variant="danger">Salah</Badge>
                          ) : (
                            <Badge variant="neutral">Manual</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {attemptDetail.events.length > 0 ? (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 p-3 text-xs">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                        <span>Jejak Peristiwa Sesi ({attemptDetail.events.length})</span>
                      </p>
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {attemptDetail.events.map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0"
                          >
                            <span>
                              <Badge variant="neutral" className="mr-1.5 font-mono text-[10px]">
                                {ev.eventSource}
                              </Badge>
                              <strong className="font-mono">{ev.eventType}</strong>
                            </span>
                            <span className="text-slate-500">
                              {formatDateTimeId(ev.createdAtUtc, timeZone)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
