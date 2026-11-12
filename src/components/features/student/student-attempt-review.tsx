"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flag,
  Loader2,
  Send,
} from "lucide-react";
import type {
  AttemptQuestionStudentView,
  PendingAnswerQueueItem,
  StudentAttemptWorkspacePayload,
  StudentResponsePayload,
} from "@/domain/exams/phase3-types";
import {
  clearAttemptPendingDrafts,
  generateClientUuid,
  listPendingAnswerDrafts,
} from "@/lib/exam-storage";
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

function hasFilledAnswer(response: StudentResponsePayload | null): boolean {
  if (!response) return false;
  if (response.questionType === "single_choice" || response.questionType === "true_false") {
    return Boolean(response.selectedOptionKey);
  }
  if (response.questionType === "multiple_choice") {
    return response.selectedOptionKeys.length > 0;
  }
  return response.textAnswer.trim().length > 0;
}

export function StudentAttemptReview({
  workspace,
}: {
  workspace: StudentAttemptWorkspacePayload;
}) {
  const router = useRouter();
  const attemptId = workspace.attempt.id;
  const [submitIdempotencyKey] = React.useState(() => generateClientUuid());
  const [pendingLocal, setPendingLocal] = React.useState<PendingAnswerQueueItem[]>([]);
  const [syncingPending, setSyncingPending] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void listPendingAnswerDrafts(attemptId).then(async (drafts) => {
      if (cancelled) return;
      setPendingLocal(drafts);
      if (drafts.length > 0 && navigator.onLine) {
        setSyncingPending(true);
        for (const item of drafts) {
          try {
            await fetch(`/api/student/attempts/${attemptId}/answers`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                attemptQuestionId: item.attemptQuestionId,
                idempotencyKey: item.idempotencyKey,
                clientRevision: item.clientRevision,
                responsePayload: item.responsePayload,
                isFlaggedForReview: item.isFlaggedForReview,
              }),
            });
          } catch {
            break;
          }
        }
        const remaining = await listPendingAnswerDrafts(attemptId);
        if (!cancelled) {
          setPendingLocal(remaining);
          setSyncingPending(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  const answeredCount = workspace.questions.filter((q) => hasFilledAnswer(q.currentResponse)).length;
  const unansweredCount = workspace.questions.length - answeredCount;
  const flaggedCount = workspace.questions.filter((q) => q.isFlaggedForReview).length;
  const pendingSet = new Set(pendingLocal.map((d) => d.attemptQuestionId));

  async function handleConfirmSubmit() {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/student/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: submitIdempotencyKey,
          confirmedUnansweredAck: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        receiptCode?: string;
      };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Gagal mengumpulkan ujian.");
        setSubmitting(false);
        return;
      }

      await clearAttemptPendingDrafts(attemptId);
      router.push(`/student/attempts/${attemptId}/receipt`);
    } catch {
      setErrorMsg("Koneksi internet terputus saat mengirim pengumpulan akhir. Coba lagi.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-3 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tinjauan Akhir Sebelum Pengumpulan</h1>
          <p className="mt-1 text-sm text-slate-600">
            {workspace.examTitle} • {workspace.subjectName}
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href={`/student/attempts/${attemptId}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali Kerjakan Soal</span>
          </Link>
        </Button>
      </div>

      {workspace.attempt.status === "SUBMITTED" || workspace.attempt.status === "EXPIRED" ? (
        <Alert variant="info" title="Ujian Sudah Dikumpulkan">
          Sesi ujian ini sudah final.{" "}
          <Link href={`/student/attempts/${attemptId}/receipt`} className="font-semibold underline">
            Lihat bukti pengumpulan
          </Link>
          .
        </Alert>
      ) : null}

      {pendingLocal.length > 0 ? (
        <Alert variant="warning" title="Masih Ada Jawaban Belum Tersinkron ke Server">
          Terdapat {pendingLocal.length} perubahan jawaban di penyimpanan lokal perangkat yang belum
          dikonfirmasi server. Kembalilah ke halaman pengerjaan atau pastikan koneksi pulih agar
          tidak ada jawaban yang tertinggal.
        </Alert>
      ) : null}

      {unansweredCount > 0 || flaggedCount > 0 ? (
        <Alert variant="warning" title="Periksa Kembali Kelengkapan Jawaban">
          Masih ada <strong>{unansweredCount} soal belum dijawab</strong> dan{" "}
          <strong>{flaggedCount} soal ditandai ragu-ragu</strong>. Setelah dikumpulkan, jawaban
          tidak dapat diubah kembali.
        </Alert>
      ) : (
        <Alert variant="success" title="Semua Soal Sudah Dijawab">
          Seluruh {workspace.questions.length} soal telah terisi dan siap dikumpulkan secara resmi.
        </Alert>
      )}

      {errorMsg ? <Alert variant="danger">{errorMsg}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Status Setiap Nomor Soal</CardTitle>
          <CardDescription>
            Terjawab {answeredCount} dari {workspace.questions.length} soal • Belum dijawab{" "}
            {unansweredCount} • Ragu-ragu {flaggedCount}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
            {workspace.questions.map((q: AttemptQuestionStudentView) => {
              const answered = hasFilledAnswer(q.currentResponse);
              const flagged = q.isFlaggedForReview;
              const isUnsynced = pendingSet.has(q.attemptQuestionId);

              return (
                <Link
                  key={q.attemptQuestionId}
                  href={`/student/attempts/${attemptId}`}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition hover:border-blue-500 ${
                    flagged
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : answered
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  <span className="font-semibold">No. {q.displayIndex}</span>
                  <span className="flex items-center gap-1 text-xs">
                    {isUnsynced ? (
                      <Badge variant="warning">Lokal</Badge>
                    ) : flagged ? (
                      <Flag className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
                    ) : answered ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    )}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <Button asChild variant="outline">
              <Link href={`/student/attempts/${attemptId}`}>Kembali Periksa Jawaban</Link>
            </Button>

            <Button
              type="button"
              size="lg"
              disabled={
                syncingPending ||
                workspace.attempt.status !== "IN_PROGRESS" ||
                pendingLocal.length > 0
              }
              onClick={() => setConfirmOpen(true)}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>Kumpulkan Ujian</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <Card className="w-full max-w-md border-slate-200 bg-white">
            <CardHeader>
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                <CardTitle id="submit-confirm-title">Konfirmasi Pengumpulan Resmi</CardTitle>
              </div>
              <CardDescription>
                Setelah ujian dikumpulkan, sesi akan terkunci secara permanen di server dan tidak
                dapat dibuka ulang.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <p>
                  Terjawab: <strong>{answeredCount}</strong> dari{" "}
                  <strong>{workspace.questions.length}</strong> soal
                </p>
                <p>
                  Belum dijawab: <strong>{unansweredCount}</strong> soal
                </p>
                <p>
                  Ditandai ragu-ragu: <strong>{flaggedCount}</strong> soal
                </p>
              </div>

              {errorMsg ? <Alert variant="danger">{errorMsg}</Alert> : null}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleConfirmSubmit()}
                  className="bg-emerald-700 text-white hover:bg-emerald-800"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  <span>{submitting ? "Mengumpulkan..." : "Ya, Kumpulkan Sekarang"}</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
