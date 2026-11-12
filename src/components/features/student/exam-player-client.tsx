"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  Flag,
  Grid2x2,
  Loader2,
  RefreshCw,
  Send,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type {
  AuthoritativeAnswerAck,
  AttemptLifecycleStatus,
} from "@/domain/exams/contracts";
import type {
  AttemptQuestionStudentView,
  AttemptTimeSyncPayload,
  LocalSyncBadgeState,
  PendingAnswerQueueItem,
  StudentAttemptWorkspacePayload,
  StudentResponsePayload,
} from "@/domain/exams/phase3-types";
import {
  clearAttemptPendingDrafts,
  computeClientPayloadHash,
  generateClientUuid,
  listPendingAnswerDrafts,
  probeExamLocalStorageHealth,
  removePendingAnswerDraft,
  upsertPendingAnswerDraft,
} from "@/lib/exam-storage";
import { QuestionContentRenderer } from "@/components/features/exams/question-content-renderer";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

function formatCountdownMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

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

export function ExamPlayerClient({
  initialWorkspace,
}: {
  initialWorkspace: StudentAttemptWorkspacePayload;
}) {
  const router = useRouter();
  const attemptId = initialWorkspace.attempt.id;

  const [questions, setQuestions] = React.useState<AttemptQuestionStudentView[]>(
    initialWorkspace.questions
  );
  const [attemptStatus, setAttemptStatus] = React.useState<AttemptLifecycleStatus>(
    initialWorkspace.attempt.status
  );
  const [deadlineMs, setDeadlineMs] = React.useState<number>(() =>
    Date.parse(initialWorkspace.attempt.deadlineAtUtc)
  );
  const clockOffsetMsRef = React.useRef<number>(0);

  React.useEffect(() => {
    clockOffsetMsRef.current = Date.parse(initialWorkspace.serverNowUtc) - Date.now();
  }, [initialWorkspace.serverNowUtc]);
  const [remainingMs, setRemainingMs] = React.useState<number>(initialWorkspace.remainingMs);

  const [currentIdx, setCurrentIdx] = React.useState<number>(0);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const [isOnline, setIsOnline] = React.useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [storageWarning, setStorageWarning] = React.useState<string | null>(null);
  const [pendingDrafts, setPendingDrafts] = React.useState<Record<string, PendingAnswerQueueItem>>(
    {}
  );
  const [inFlightCount, setInFlightCount] = React.useState(0);
  const [syncErrorMsg, setSyncErrorMsg] = React.useState<string | null>(null);
  const [hasFailedSave, setHasFailedSave] = React.useState(false);
  const [navigatingToReview, setNavigatingToReview] = React.useState(false);

  const pendingDraftsRef = React.useRef<Record<string, PendingAnswerQueueItem>>({});
  const nextRevisionRef = React.useRef<Record<string, number>>({});
  const essayDebounceRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flushingRef = React.useRef(false);
  const lastVisibilityEventAtRef = React.useRef(0);

  // Initialize monotonic revision map cleanly
  React.useEffect(() => {
    const revMap: Record<string, number> = {};
    for (const q of initialWorkspace.questions) {
      revMap[q.attemptQuestionId] = q.latestRevision;
    }
    nextRevisionRef.current = revMap;
  }, [initialWorkspace.questions]);

  const flushSingleDraft = React.useCallback(
    async (item: PendingAnswerQueueItem): Promise<boolean> => {
      setInFlightCount((c) => c + 1);
      try {
        const res = await fetch(`/api/student/attempts/${attemptId}/answers`, {
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

        const data = (await res.json().catch(() => null)) as
          | (AuthoritativeAnswerAck & { error?: string })
          | null;

        if (!data) {
          setHasFailedSave(true);
          setSyncErrorMsg("Respon server tidak valid saat menyimpan jawaban.");
          return false;
        }

        if (data.serverNowUtc) {
          clockOffsetMsRef.current = Date.parse(data.serverNowUtc) - Date.now();
        }

        if (
          res.ok &&
          (data.outcome === "COMMITTED" || data.outcome === "IDEMPOTENT_REPLAY")
        ) {
          setHasFailedSave(false);
          setSyncErrorMsg(null);

          // Clear from queue ONLY if no newer local revision replaced it while inflight
          const latestLocal = pendingDraftsRef.current[item.attemptQuestionId];
          if (!latestLocal || latestLocal.clientRevision <= item.clientRevision) {
            await removePendingAnswerDraft(attemptId, item.attemptQuestionId);
            const nextPending = { ...pendingDraftsRef.current };
            delete nextPending[item.attemptQuestionId];
            pendingDraftsRef.current = nextPending;
            setPendingDrafts(nextPending);
          }

          setQuestions((prev) =>
            prev.map((q) =>
              q.attemptQuestionId === item.attemptQuestionId
                ? {
                    ...q,
                    latestRevision: Math.max(q.latestRevision, data.authoritativeRevision),
                    committedAtUtc: data.committedAtUtc ?? q.committedAtUtc,
                  }
                : q
            )
          );
          return true;
        }

        if (data.outcome === "STALE_REVISION_REJECTED") {
          // Higher revision already persisted on server; drop stale queue entry
          await removePendingAnswerDraft(attemptId, item.attemptQuestionId);
          const nextPending = { ...pendingDraftsRef.current };
          delete nextPending[item.attemptQuestionId];
          pendingDraftsRef.current = nextPending;
          setPendingDrafts(nextPending);
          nextRevisionRef.current[item.attemptQuestionId] = Math.max(
            nextRevisionRef.current[item.attemptQuestionId] ?? 0,
            data.authoritativeRevision
          );
          setHasFailedSave(false);
          return true;
        }

        if (data.outcome === "DEADLINE_EXPIRED" || res.status === 410) {
          setAttemptStatus("EXPIRED");
          await clearAttemptPendingDrafts(attemptId);
          pendingDraftsRef.current = {};
          setPendingDrafts({});
          setSyncErrorMsg("Waktu ujian berakhir. Jawaban terakhir telah ditutup oleh server.");
          return false;
        }

        if (data.outcome === "ATTEMPT_ALREADY_SUBMITTED") {
          setAttemptStatus("SUBMITTED");
          await clearAttemptPendingDrafts(attemptId);
          pendingDraftsRef.current = {};
          setPendingDrafts({});
          return false;
        }

        if (data.outcome === "ATTEMPT_CANCELLED" || res.status === 403) {
          setAttemptStatus("CANCELLED_BY_ADMIN");
          await clearAttemptPendingDrafts(attemptId);
          pendingDraftsRef.current = {};
          setPendingDrafts({});
          setSyncErrorMsg(data.message ?? data.error ?? "Sesi ujian dibatalkan oleh administrator.");
          return false;
        }

        setHasFailedSave(true);
        setSyncErrorMsg(
          data.message ?? data.error ?? "Gagal menyimpan jawaban. Sistem akan mencoba ulang."
        );
        return false;
      } catch {
        // Transient offline / network disconnect
        setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : false);
        return false;
      } finally {
        setInFlightCount((c) => Math.max(0, c - 1));
      }
    },
    [attemptId]
  );

  const flushPendingQueue = React.useCallback(async () => {
    if (flushingRef.current) return;
    if (attemptStatus !== "IN_PROGRESS" && attemptStatus !== "SUBMITTING") return;
    const queue = Object.values(pendingDraftsRef.current).sort(
      (a, b) => a.updatedAtMs - b.updatedAtMs
    );
    if (queue.length === 0) return;

    flushingRef.current = true;
    try {
      for (const item of queue) {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          break;
        }
        const ok = await flushSingleDraft(item);
        if (!ok && typeof navigator !== "undefined" && !navigator.onLine) {
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [attemptStatus, flushSingleDraft]);

  // Storage health + crash recovery restore from IndexedDB on initial mount
  React.useEffect(() => {
    let active = true;
    async function initStorageAndRecover() {
      const health = await probeExamLocalStorageHealth();
      if (!active) return;
      if (!health.storageOk && health.warning) {
        setStorageWarning(health.warning);
      }

      if (attemptStatus !== "IN_PROGRESS") return;
      const savedDrafts = await listPendingAnswerDrafts(attemptId);
      if (!active || savedDrafts.length === 0) return;

      const recoveredMap: Record<string, PendingAnswerQueueItem> = {};
      setQuestions((prev) =>
        prev.map((q) => {
          const match = savedDrafts.find(
            (d) => d.attemptQuestionId === q.attemptQuestionId && d.clientRevision > q.latestRevision
          );
          if (!match) return q;
          recoveredMap[q.attemptQuestionId] = match;
          nextRevisionRef.current[q.attemptQuestionId] = Math.max(
            nextRevisionRef.current[q.attemptQuestionId] ?? q.latestRevision,
            match.clientRevision
          );
          return {
            ...q,
            currentResponse: match.responsePayload,
            isFlaggedForReview: match.isFlaggedForReview,
          };
        })
      );

      pendingDraftsRef.current = recoveredMap;
      setPendingDrafts(recoveredMap);

      if (Object.keys(recoveredMap).length > 0 && navigator.onLine) {
        void flushPendingQueue();
      }
    }
    void initStorageAndRecover();
    return () => {
      active = false;
    };
  }, [attemptId, attemptStatus, flushPendingQueue]);

  // Network connectivity listeners + auto reconnect flush
  React.useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void fetch(`/api/student/attempts/${attemptId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "CONNECTION_RESTORED", metadata: {} }),
      }).catch(() => {});
      void flushPendingQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [attemptId, flushPendingQueue]);

  // Periodic background flush every 10s if queue is non-empty
  React.useEffect(() => {
    const interval = setInterval(() => {
      if (Object.keys(pendingDraftsRef.current).length > 0 && navigator.onLine) {
        void flushPendingQueue();
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [flushPendingQueue]);

  // Authoritative server clock resync every 45s
  const syncServerClock = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/student/attempts/${attemptId}/time`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AttemptTimeSyncPayload;
      clockOffsetMsRef.current = Date.parse(data.serverNowUtc) - Date.now();
      setDeadlineMs(Date.parse(data.deadlineAtUtc));
      setRemainingMs(data.remainingMs);
      if (data.status !== "IN_PROGRESS" && data.status !== "SUBMITTING") {
        setAttemptStatus(data.status);
      }
    } catch {
      // Offline fallback uses last synchronized clock offset
    }
  }, [attemptId]);

  React.useEffect(() => {
    const syncTimer = setInterval(() => {
      void syncServerClock();
    }, 45_000);
    return () => clearInterval(syncTimer);
  }, [syncServerClock]);

  // Smooth local countdown ticking from server-corrected clock offset
  React.useEffect(() => {
    if (attemptStatus !== "IN_PROGRESS" && attemptStatus !== "SUBMITTING") return;
    const tick = setInterval(() => {
      const estimatedServerNowMs = Date.now() + clockOffsetMsRef.current;
      const rem = Math.max(0, deadlineMs - estimatedServerNowMs);
      setRemainingMs(rem);
      if (rem === 0) {
        void syncServerClock();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [attemptStatus, deadlineMs, syncServerClock]);

  // Unobtrusive visibility telemetry logging (throttled to avoid noisy bursts)
  React.useEffect(() => {
    if (attemptStatus !== "IN_PROGRESS") return;
    const onVisibilityChange = () => {
      const now = Date.now();
      if (now - lastVisibilityEventAtRef.current < 3000) return;
      lastVisibilityEventAtRef.current = now;
      const eventType = document.hidden ? "PAGE_HIDDEN" : "PAGE_VISIBLE";
      void fetch(`/api/student/attempts/${attemptId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, metadata: { ts: now } }),
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [attemptId, attemptStatus]);

  const queueAndPersistAnswer = React.useCallback(
    async (
      question: AttemptQuestionStudentView,
      nextResponse: StudentResponsePayload,
      immediate: boolean
    ) => {
      if (attemptStatus !== "IN_PROGRESS") return;

      const qaId = question.attemptQuestionId;
      const rev = (nextRevisionRef.current[qaId] ?? question.latestRevision) + 1;
      nextRevisionRef.current[qaId] = rev;

      const idempotencyKey = generateClientUuid();
      const payloadHash = await computeClientPayloadHash(qaId, nextResponse);

      const queueItem: PendingAnswerQueueItem = {
        attemptId,
        attemptQuestionId: qaId,
        clientRevision: rev,
        idempotencyKey,
        payloadHash,
        responsePayload: nextResponse,
        isFlaggedForReview: question.isFlaggedForReview,
        updatedAtMs: Date.now(),
        attemptCount: 0,
      };

      const nextPending = { ...pendingDraftsRef.current, [qaId]: queueItem };
      pendingDraftsRef.current = nextPending;
      setPendingDrafts(nextPending);

      const storageResult = await upsertPendingAnswerDraft(queueItem);
      if (!storageResult.persistedToIndexedDb && storageResult.error) {
        setStorageWarning(
          `Draf lokal tidak dapat disimpan (${storageResult.error}). Pastikan koneksi stabil agar status Tersimpan tercapai.`
        );
      }

      if (immediate && navigator.onLine) {
        void flushSingleDraft(queueItem);
      }
    },
    [attemptId, attemptStatus, flushSingleDraft]
  );

  function updateObjectiveAnswer(
    question: AttemptQuestionStudentView,
    nextResponse: StudentResponsePayload
  ) {
    if (attemptStatus !== "IN_PROGRESS") return;
    setQuestions((prev) =>
      prev.map((q) =>
        q.attemptQuestionId === question.attemptQuestionId
          ? { ...q, currentResponse: nextResponse }
          : q
      )
    );
    void queueAndPersistAnswer(question, nextResponse, true);
  }

  function updateEssayText(question: AttemptQuestionStudentView, nextText: string) {
    if (attemptStatus !== "IN_PROGRESS") return;
    const qaId = question.attemptQuestionId;
    const nextResponse: StudentResponsePayload = {
      questionType: "essay",
      textAnswer: nextText,
    };

    setQuestions((prev) =>
      prev.map((q) => (q.attemptQuestionId === qaId ? { ...q, currentResponse: nextResponse } : q))
    );

    // Stage synchronously into IndexedDB immediately with debounced network flush
    if (essayDebounceRef.current[qaId]) {
      clearTimeout(essayDebounceRef.current[qaId]);
    }
    essayDebounceRef.current[qaId] = setTimeout(() => {
      delete essayDebounceRef.current[qaId];
      void queueAndPersistAnswer(question, nextResponse, true);
    }, 600);
  }

  async function flushCurrentEssayIfPending() {
    const q = questions[currentIdx];
    if (!q || q.questionType !== "essay") return;
    const qaId = q.attemptQuestionId;
    if (essayDebounceRef.current[qaId]) {
      clearTimeout(essayDebounceRef.current[qaId]);
      delete essayDebounceRef.current[qaId];
      const payload: StudentResponsePayload = q.currentResponse ?? {
        questionType: "essay",
        textAnswer: "",
      };
      await queueAndPersistAnswer(q, payload, true);
    }
  }

  async function switchQuestion(targetIdx: number) {
    await flushCurrentEssayIfPending();
    setCurrentIdx(targetIdx);
    setPaletteOpen(false);
  }

  async function handleToggleFlag(question: AttemptQuestionStudentView) {
    if (attemptStatus !== "IN_PROGRESS") return;
    const nextFlag = !question.isFlaggedForReview;
    setQuestions((prev) =>
      prev.map((q) =>
        q.attemptQuestionId === question.attemptQuestionId
          ? { ...q, isFlaggedForReview: nextFlag }
          : q
      )
    );

    try {
      const res = await fetch(`/api/student/attempts/${attemptId}/flag`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attemptQuestionId: question.attemptQuestionId,
          isFlaggedForReview: nextFlag,
        }),
      });
      if (!res.ok) throw new Error("FLAG_FAILED");
    } catch {
      // Revert cleanly if offline/failed
      setQuestions((prev) =>
        prev.map((q) =>
          q.attemptQuestionId === question.attemptQuestionId
            ? { ...q, isFlaggedForReview: !nextFlag }
            : q
        )
      );
      setSyncErrorMsg("Gagal mengubah penanda ragu-ragu karena koneksi sedang terganggu.");
    }
  }

  async function handleGoToReview() {
    setNavigatingToReview(true);
    await flushCurrentEssayIfPending();
    if (navigator.onLine) {
      await flushPendingQueue();
    }
    router.push(`/student/attempts/${attemptId}/review`);
  }

  const pendingKeys = Object.keys(pendingDrafts);
  let badgeState: LocalSyncBadgeState;
  if (!isOnline) {
    badgeState = "Menunggu koneksi";
  } else if (inFlightCount > 0) {
    badgeState = "Menyimpan...";
  } else if (hasFailedSave) {
    badgeState = "Gagal menyimpan";
  } else if (pendingKeys.length > 0) {
    badgeState = "Sinkronisasi diperlukan";
  } else {
    badgeState = "Tersimpan";
  }

  const answeredCount = questions.filter((q) => hasFilledAnswer(q.currentResponse)).length;
  const flaggedCount = questions.filter((q) => q.isFlaggedForReview).length;
  const activeQuestion = questions[currentIdx];

  const isWarningTime = remainingMs <= 10 * 60_000 && remainingMs > 5 * 60_000;
  const isCriticalTime = remainingMs <= 5 * 60_000;

  if (attemptStatus === "SUBMITTED" || attemptStatus === "EXPIRED" || attemptStatus === "CANCELLED_BY_ADMIN") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-4 py-10">
        <Card className="w-full border-slate-200">
          <CardHeader>
            <CardTitle>
              {attemptStatus === "CANCELLED_BY_ADMIN"
                ? "Sesi Ujian Dibatalkan"
                : attemptStatus === "EXPIRED"
                  ? "Waktu Ujian Telah Habis"
                  : "Ujian Sudah Dikumpulkan"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant={attemptStatus === "CANCELLED_BY_ADMIN" ? "danger" : "info"}>
              {attemptStatus === "CANCELLED_BY_ADMIN"
                ? initialWorkspace.attempt.cancellationReason ??
                  "Sesi ujian ini telah dibatalkan oleh administrator sekolah."
                : "Sesi ujian ini sudah difinalisasi oleh server. Jawaban tidak dapat diubah lagi."}
            </Alert>
            {attemptStatus === "CANCELLED_BY_ADMIN" ? (
              <Button className="w-full" onClick={() => router.push("/student/exams")}>
                Kembali ke Daftar Ujian
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => router.push(`/student/attempts/${attemptId}/receipt`)}
              >
                Lihat Bukti Pengumpulan Resmi
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 lg:pb-8">
      {/* Sticky Focused Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
              {initialWorkspace.examTitle}
            </p>
            <p className="truncate text-xs text-slate-600">
              {initialWorkspace.subjectName} • Percobaan {initialWorkspace.attempt.attemptNumber}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Network Status */}
            <Badge
              variant={isOnline ? "success" : "warning"}
              className="flex items-center gap-1"
              aria-live="polite"
            >
              {isOnline ? (
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{isOnline ? "Online" : "Terputus"}</span>
            </Badge>

            {/* Authoritative Save State */}
            <Badge
              variant={
                badgeState === "Tersimpan"
                  ? "success"
                  : badgeState === "Menyimpan..."
                    ? "default"
                    : badgeState === "Gagal menyimpan"
                      ? "danger"
                      : "warning"
              }
              aria-live="polite"
            >
              {badgeState}
              {pendingKeys.length > 0 ? ` (${pendingKeys.length})` : ""}
            </Badge>

            {/* Authoritative Server Timer */}
            <div
              role="timer"
              aria-label={`Sisa waktu ${formatCountdownMs(remainingMs)}`}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1 font-mono text-sm font-bold ${
                isCriticalTime
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : isWarningTime
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-100 text-slate-900"
              }`}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              <span>{formatCountdownMs(remainingMs)}</span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              onClick={() => setPaletteOpen(true)}
            >
              <Grid2x2 className="h-4 w-4" aria-hidden="true" />
              <span>
                {currentIdx + 1}/{questions.length}
              </span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 pt-4 sm:px-6">
        {/* Non-blocking Alerts */}
        <div className="space-y-2 pb-4">
          {!isOnline ? (
            <Alert variant="warning" title="Koneksi Internet Terputus">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Jawaban baru disimpan sementara di perangkat ini ({pendingKeys.length} perubahan
                  tertunda). Jangan tutup tab browser hingga koneksi pulih.
                </span>
              </div>
            </Alert>
          ) : pendingKeys.length > 0 ? (
            <Alert variant="warning" title="Sinkronisasi Jawaban Tertunda">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Terdapat {pendingKeys.length} jawaban lokal yang menunggu konfirmasi server.
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => void flushPendingQueue()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Coba Kirim Sekarang</span>
                </Button>
              </div>
            </Alert>
          ) : null}

          {syncErrorMsg ? (
            <Alert variant="danger" title="Peringatan Penyimpanan">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{syncErrorMsg}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void flushPendingQueue()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Coba Lagi</span>
                </Button>
              </div>
            </Alert>
          ) : null}

          {storageWarning ? (
            <Alert variant="warning" title="Peringatan Penyimpanan Lokal">
              <div className="flex items-start gap-2">
                <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{storageWarning}</span>
              </div>
            </Alert>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Active Question Workspace */}
          <main className="space-y-4">
            {activeQuestion ? (
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="text-xs font-semibold">
                        Soal {activeQuestion.displayIndex} dari {questions.length}
                      </Badge>
                      <Badge variant="neutral">
                        {activeQuestion.questionType === "single_choice"
                          ? "Pilihan Ganda"
                          : activeQuestion.questionType === "multiple_choice"
                            ? "Pilihan Ganda Kompleks"
                            : activeQuestion.questionType === "true_false"
                              ? "Benar / Salah"
                              : "Esai"}
                      </Badge>
                      <span className="text-xs font-medium text-slate-500">
                        Bobot {activeQuestion.points} poin
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant={activeQuestion.isFlaggedForReview ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => void handleToggleFlag(activeQuestion)}
                      className={
                        activeQuestion.isFlaggedForReview
                          ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                          : ""
                      }
                    >
                      <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {activeQuestion.isFlaggedForReview ? "Ditandai Ragu" : "Tandai Ragu-ragu"}
                      </span>
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 pt-5">
                  <div className="text-base text-slate-900">
                    <QuestionContentRenderer content={activeQuestion.stem} />
                  </div>

                  {/* Single Choice or True/False */}
                  {(activeQuestion.questionType === "single_choice" ||
                    activeQuestion.questionType === "true_false") && (
                    <div className="space-y-3">
                      <div
                        role="radiogroup"
                        aria-label={`Pilihan jawaban soal ${activeQuestion.displayIndex}`}
                        className="space-y-2.5"
                      >
                        {activeQuestion.options.map((opt) => {
                          const selectedKey =
                            activeQuestion.currentResponse?.questionType === "single_choice" ||
                            activeQuestion.currentResponse?.questionType === "true_false"
                              ? activeQuestion.currentResponse.selectedOptionKey
                              : null;
                          const isSelected = selectedKey === opt.optionKey;

                          return (
                            <label
                              key={opt.optionKey}
                              className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50/70 ring-1 ring-blue-600"
                                  : "border-slate-200 bg-white hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`q-${activeQuestion.attemptQuestionId}`}
                                value={opt.optionKey}
                                checked={isSelected}
                                onChange={() =>
                                  updateObjectiveAnswer(activeQuestion, {
                                    questionType: activeQuestion.questionType as
                                      | "single_choice"
                                      | "true_false",
                                    selectedOptionKey: opt.optionKey,
                                  })
                                }
                                className="mt-1 h-4 w-4 text-blue-700"
                              />
                              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-800">
                                {opt.optionKey}
                              </span>
                              <div className="min-w-0 flex-1">
                                <QuestionContentRenderer content={opt.optionText} />
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {hasFilledAnswer(activeQuestion.currentResponse) ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateObjectiveAnswer(activeQuestion, {
                              questionType: activeQuestion.questionType as
                                | "single_choice"
                                | "true_false",
                              selectedOptionKey: null,
                            })
                          }
                          className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                        >
                          Batalkan pilihan jawaban
                        </button>
                      ) : null}
                    </div>
                  )}

                  {/* Multiple Choice */}
                  {activeQuestion.questionType === "multiple_choice" && (
                    <div
                      role="group"
                      aria-label={`Pilihan ganda kompleks soal ${activeQuestion.displayIndex}`}
                      className="space-y-2.5"
                    >
                      <p className="text-xs font-medium text-slate-600">
                        Pilih semua jawaban yang benar:
                      </p>
                      {activeQuestion.options.map((opt) => {
                        const selectedKeys =
                          activeQuestion.currentResponse?.questionType === "multiple_choice"
                            ? activeQuestion.currentResponse.selectedOptionKeys
                            : [];
                        const isChecked = selectedKeys.includes(opt.optionKey);

                        return (
                          <label
                            key={opt.optionKey}
                            className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                              isChecked
                                ? "border-blue-600 bg-blue-50/70 ring-1 ring-blue-600"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const nextKeys = e.target.checked
                                  ? Array.from(new Set([...selectedKeys, opt.optionKey]))
                                  : selectedKeys.filter((k) => k !== opt.optionKey);
                                updateObjectiveAnswer(activeQuestion, {
                                  questionType: "multiple_choice",
                                  selectedOptionKeys: nextKeys,
                                });
                              }}
                              className="mt-1 h-4 w-4 rounded text-blue-700"
                            />
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-800">
                              {opt.optionKey}
                            </span>
                            <div className="min-w-0 flex-1">
                              <QuestionContentRenderer content={opt.optionText} />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Essay */}
                  {activeQuestion.questionType === "essay" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <label
                          htmlFor={`essay-${activeQuestion.attemptQuestionId}`}
                          className="font-medium"
                        >
                          Jawaban Esai Anda
                        </label>
                        <span className="font-mono">
                          {(activeQuestion.currentResponse?.questionType === "essay"
                            ? activeQuestion.currentResponse.textAnswer.length
                            : 0
                          ).toLocaleString("id-ID")}{" "}
                          / 30.000 karakter
                        </span>
                      </div>
                      <Textarea
                        id={`essay-${activeQuestion.attemptQuestionId}`}
                        rows={8}
                        maxLength={30_000}
                        placeholder="Tuliskan jawaban Anda secara jelas dan terstruktur..."
                        value={
                          activeQuestion.currentResponse?.questionType === "essay"
                            ? activeQuestion.currentResponse.textAnswer
                            : ""
                        }
                        onChange={(e) => updateEssayText(activeQuestion, e.target.value)}
                        onBlur={() => void flushCurrentEssayIfPending()}
                        className="text-base leading-relaxed"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {/* Question Navigation Footer — intentionally separates "Sebelumnya / Berikutnya" from "Tinjau & Kumpulkan" */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <Button
                type="button"
                variant="outline"
                disabled={currentIdx === 0}
                onClick={() => void switchQuestion(Math.max(0, currentIdx - 1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span>Sebelumnya</span>
              </Button>

              <div className="flex items-center gap-2">
                {currentIdx < questions.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => void switchQuestion(Math.min(questions.length - 1, currentIdx + 1))}
                  >
                    <span>Berikutnya</span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={navigatingToReview}
                    onClick={() => void handleGoToReview()}
                    className="bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    {navigatingToReview ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>Tinjau &amp; Kumpulkan</span>
                  </Button>
                )}
              </div>
            </div>
          </main>

          {/* Desktop Question Navigator Sidebar */}
          <aside aria-label="Navigasi nomor soal" className="hidden lg:block">
            <div className="sticky top-20 space-y-4">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Navigasi Nomor Soal
                  </CardTitle>
                  <p className="text-xs text-slate-600">
                    Terjawab: <strong>{answeredCount}</strong>/{questions.length} • Ragu:{" "}
                    <strong>{flaggedCount}</strong>
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-5 gap-2">
                    {questions.map((q, idx) => {
                      const answered = hasFilledAnswer(q.currentResponse);
                      const flagged = q.isFlaggedForReview;
                      const pending = Boolean(pendingDrafts[q.attemptQuestionId]);
                      const active = idx === currentIdx;

                      let styleClass = "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
                      if (flagged) {
                        styleClass = "border-amber-400 bg-amber-100 text-amber-900 font-semibold";
                      } else if (answered) {
                        styleClass = "border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold";
                      }

                      return (
                        <button
                          key={q.attemptQuestionId}
                          type="button"
                          onClick={() => void switchQuestion(idx)}
                          aria-label={`Soal nomor ${q.displayIndex}${answered ? ", sudah dijawab" : ""}${
                            flagged ? ", ditandai ragu" : ""
                          }`}
                          aria-current={active ? "step" : undefined}
                          className={`relative flex h-10 items-center justify-center rounded-lg border text-sm transition ${styleClass} ${
                            active ? "ring-2 ring-blue-700 ring-offset-1" : ""
                          }`}
                        >
                          <span>{q.displayIndex}</span>
                          {pending ? (
                            <span
                              title="Menunggu sinkronisasi server"
                              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded border border-emerald-500 bg-emerald-50" />
                      <span>Sudah dijawab</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded border border-amber-400 bg-amber-100" />
                      <span>Ditandai ragu-ragu</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded border border-slate-200 bg-white" />
                      <span>Belum dijawab</span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="w-full"
                    variant="outline"
                    disabled={navigatingToReview}
                    onClick={() => void handleGoToReview()}
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    <span>Tinjau Jawaban &amp; Selesai</span>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile Bottom Quick Bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 lg:hidden">
        <span className="text-xs font-medium text-slate-700">
          Terjawab <strong>{answeredCount}</strong>/{questions.length}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
            <Grid2x2 className="h-4 w-4" aria-hidden="true" />
            <span>Daftar Soal</span>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={navigatingToReview}
            onClick={() => void handleGoToReview()}
          >
            <span>Tinjau</span>
          </Button>
        </div>
      </div>

      {/* Mobile Palette Overlay Modal */}
      {paletteOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigasi nomor soal"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4 lg:hidden"
        >
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Daftar Nomor Soal</h2>
                <p className="text-xs text-slate-600">
                  Terjawab {answeredCount}/{questions.length} • Ragu {flaggedCount}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup daftar soal"
                onClick={() => setPaletteOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2 py-4">
              {questions.map((q, idx) => {
                const answered = hasFilledAnswer(q.currentResponse);
                const flagged = q.isFlaggedForReview;
                const active = idx === currentIdx;

                let styleClass = "border-slate-200 bg-white text-slate-700";
                if (flagged) {
                  styleClass = "border-amber-400 bg-amber-100 text-amber-900 font-semibold";
                } else if (answered) {
                  styleClass = "border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold";
                }

                return (
                  <button
                    key={q.attemptQuestionId}
                    type="button"
                    onClick={() => void switchQuestion(idx)}
                    className={`flex h-11 items-center justify-center rounded-lg border text-sm ${styleClass} ${
                      active ? "ring-2 ring-blue-700" : ""
                    }`}
                  >
                    {q.displayIndex}
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={navigatingToReview}
              onClick={() => void handleGoToReview()}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span>Tinjau Jawaban &amp; Kumpulkan</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
