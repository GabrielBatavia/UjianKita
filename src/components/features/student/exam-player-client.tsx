"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
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
import type {
  MonitoringEventType,
  StudentSecurityPolicyView,
} from "@/domain/monitoring/phase4-types";
import { StudentExamWatermark } from "@/components/features/student/student-exam-watermark";
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
import { cn } from "@/lib/utils";
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

function subscribeBrowserOnline(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getBrowserOnlineSnapshot(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
    ? navigator.onLine
    : true;
}

function getBrowserOnlineServerSnapshot(): boolean {
  return true;
}

interface ExamCountdownBadgeProps {
  initialRemainingMs: number;
  deadlineMs: number;
  clockOffsetMsRef: React.RefObject<number>;
  attemptStatus: AttemptLifecycleStatus;
  onExpire: () => void;
}

const ExamCountdownBadge = React.memo(function ExamCountdownBadge({
  initialRemainingMs,
  deadlineMs,
  clockOffsetMsRef,
  attemptStatus,
  onExpire,
}: ExamCountdownBadgeProps) {
  const [remainingMs, setRemainingMs] = React.useState(initialRemainingMs);

  React.useEffect(() => {
    const estimatedServerNowMs = Date.now() + (clockOffsetMsRef.current ?? 0);
    setRemainingMs(Math.max(0, deadlineMs - estimatedServerNowMs));
  }, [deadlineMs, clockOffsetMsRef]);

  React.useEffect(() => {
    if (attemptStatus !== "IN_PROGRESS" && attemptStatus !== "SUBMITTING") return;
    const tick = setInterval(() => {
      const estimatedServerNowMs = Date.now() + (clockOffsetMsRef.current ?? 0);
      const rem = Math.max(0, deadlineMs - estimatedServerNowMs);
      setRemainingMs(rem);
      if (rem === 0) {
        onExpire();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [attemptStatus, deadlineMs, clockOffsetMsRef, onExpire]);

  const isWarningTime = remainingMs <= 10 * 60_000 && remainingMs > 5 * 60_000;
  const isCriticalTime = remainingMs <= 5 * 60_000;

  return (
    <div
      role="timer"
      aria-label={`Sisa waktu ${formatCountdownMs(remainingMs)}`}
      className={cn(
        "flex shrink-0 min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1 font-mono text-sm sm:text-base font-bold shadow-2xs",
        isCriticalTime
          ? "border-rose-300 bg-rose-50 text-rose-700 animate-pulse"
          : isWarningTime
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-slate-200 bg-slate-50 text-slate-900"
      )}
    >
      <Clock
        className={cn(
          "h-4 w-4",
          isCriticalTime
            ? "text-rose-600"
            : isWarningTime
              ? "text-amber-600"
              : "text-slate-500"
        )}
        aria-hidden="true"
      />
      <span>{formatCountdownMs(remainingMs)}</span>
    </div>
  );
});

export function ExamPlayerClient({
  initialWorkspace,
  securityPolicy = null,
  studentDisplayName = "Peserta Ujian",
}: {
  initialWorkspace: StudentAttemptWorkspacePayload;
  securityPolicy?: StudentSecurityPolicyView | null;
  studentDisplayName?: string;
}) {
  const router = useRouter();
  const attemptId = initialWorkspace.attempt.id;
  const [focusNoticeCount, setFocusNoticeCount] = React.useState(0);

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

  const [currentIdx, setCurrentIdx] = React.useState<number>(0);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Lock body scroll and close on Escape when palette overlay is open
  React.useEffect(() => {
    if (!paletteOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaletteOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalStyle;
    };
  }, [paletteOpen]);

  const browserOnline = React.useSyncExternalStore(
    subscribeBrowserOnline,
    getBrowserOnlineSnapshot,
    getBrowserOnlineServerSnapshot
  );
  const [fetchOffline, setFetchOffline] = React.useState(false);
  const isOnline = browserOnline && !fetchOffline;
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
  const hiddenStartedAtRef = React.useRef<number | null>(null);
  const monitoringQueueRef = React.useRef<
    Array<{
      clientEventId: string;
      eventType: MonitoringEventType;
      occurredAt: string;
      metadata: Record<string, unknown>;
    }>
  >([]);

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
          setFetchOffline(false);
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
        if (typeof navigator === "undefined" || navigator.onLine === false) {
          setFetchOffline(true);
        }
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
      setFetchOffline(false);
      void fetch(`/api/student/attempts/${attemptId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "CONNECTION_RESTORED", metadata: {} }),
      }).catch(() => {});
      void flushPendingQueue();
    };
    const handleOffline = () => {
      setFetchOffline(true);
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

  const flushMonitoringQueue = React.useCallback(
    async (useBeacon = false) => {
      if (monitoringQueueRef.current.length === 0) return;
      const batch = monitoringQueueRef.current.splice(0, 25);
      const url = `/api/student/attempts/${attemptId}/events`;
      const bodyStr = JSON.stringify({ events: batch });

      if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        try {
          const blob = new Blob([bodyStr], { type: "application/json" });
          if (navigator.sendBeacon(url, blob)) {
            return;
          }
        } catch {
          // Fall through to keepalive fetch
        }
      }

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyStr,
          keepalive: useBeacon,
        });
        if (!res.ok) {
          // Non-blocking: requeue up to 25 newest events if transient server failure
          monitoringQueueRef.current = [...batch, ...monitoringQueueRef.current].slice(0, 25);
        }
      } catch {
        monitoringQueueRef.current = [...batch, ...monitoringQueueRef.current].slice(0, 25);
      }
    },
    [attemptId]
  );

  const enqueueMonitoringEvent = React.useCallback(
    (eventType: MonitoringEventType, metadata: Record<string, unknown> = {}) => {
      if (attemptStatus !== "IN_PROGRESS") return;
      monitoringQueueRef.current = [
        ...monitoringQueueRef.current.slice(-24),
        {
          clientEventId: generateClientUuid(),
          eventType,
          occurredAt: new Date().toISOString(),
          metadata,
        },
      ];
      if (monitoringQueueRef.current.length >= 5) {
        void flushMonitoringQueue(false);
      }
    },
    [attemptStatus, flushMonitoringQueue]
  );

  // Jittered ~30s connection heartbeat + periodic monitoring flush + reload detection
  React.useEffect(() => {
    if (attemptStatus !== "IN_PROGRESS") return;

    // Reload recovery detection via sessionStorage
    try {
      const seenKey = `ujk:attempt-seen:${attemptId}`;
      if (window.sessionStorage.getItem(seenKey)) {
        enqueueMonitoringEvent("EXAM_PAGE_RELOADED", { ts: Date.now() });
      }
      window.sessionStorage.setItem(seenKey, "1");
    } catch {
      // ignore storage errors
    }

    const sendHeartbeat = () => {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
      const isExamBro = ua.includes("exambro") || ua.includes("dekikurnia");
      const isSeb =
        typeof window !== "undefined" && Boolean((window as { SafeExamBrowser?: unknown }).SafeExamBrowser);
      void fetch(`/api/student/attempts/${attemptId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visible: typeof document !== "undefined" ? !document.hidden : true,
          online: typeof navigator !== "undefined" ? navigator.onLine : true,
          queuedAnswerCount: Object.keys(pendingDraftsRef.current).length,
          browserPlatformHint: isSeb
            ? "IOS_SAFE_EXAM_BROWSER"
            : isExamBro
              ? "ANDROID_EXAMBRO"
              : "STANDARD_WEB",
          exambroHint: isExamBro,
          clientTimestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    };

    const baseIntervalMs = (securityPolicy?.heartbeatIntervalSeconds ?? 30) * 1000;
    const jitterMs = Math.floor(Math.random() * 4000) - 2000;
    const heartbeatMs = Math.max(15_000, baseIntervalMs + jitterMs);

    const initTimeout = window.setTimeout(sendHeartbeat, 400);
    const heartbeatTimer = window.setInterval(sendHeartbeat, heartbeatMs);
    const flushTimer = window.setInterval(() => {
      void flushMonitoringQueue(false);
    }, 8_000);

    const onPageHide = () => {
      void flushMonitoringQueue(true);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearTimeout(initTimeout);
      window.clearInterval(heartbeatTimer);
      window.clearInterval(flushTimer);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [attemptId, attemptStatus, enqueueMonitoringEvent, flushMonitoringQueue, securityPolicy?.heartbeatIntervalSeconds]);

  // Unobtrusive visibility telemetry logging (batched, deduplicated, zero blocking)
  React.useEffect(() => {
    if (attemptStatus !== "IN_PROGRESS") return;
    const onVisibilityChange = () => {
      const now = Date.now();
      if (document.hidden) {
        hiddenStartedAtRef.current = now;
        if (now - lastVisibilityEventAtRef.current < 2000) return;
        lastVisibilityEventAtRef.current = now;
        enqueueMonitoringEvent("EXAM_PAGE_HIDDEN", { ts: now });
        setFocusNoticeCount((c) => c + 1);
      } else {
        const hiddenDurationSeconds = hiddenStartedAtRef.current
          ? Math.max(0, Math.round((now - hiddenStartedAtRef.current) / 1000))
          : 0;
        hiddenStartedAtRef.current = null;
        lastVisibilityEventAtRef.current = now;
        enqueueMonitoringEvent("EXAM_PAGE_VISIBLE", {
          ts: now,
          hiddenDurationSeconds,
        });
      }
      void flushMonitoringQueue(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [attemptStatus, enqueueMonitoringEvent, flushMonitoringQueue]);

  const copyGuardEnabled = securityPolicy?.copyPasteGuardEnabled ?? true;
  const contextGuardEnabled = securityPolicy?.contextMenuGuardEnabled ?? true;

  const handlePromptCopy = React.useCallback(
    (e: React.ClipboardEvent) => {
      if (!copyGuardEnabled) return;
      e.preventDefault();
      enqueueMonitoringEvent("COPY_EVENT_OBSERVED", { scope: "question_prompt" });
      setFocusNoticeCount((c) => c + 1);
    },
    [copyGuardEnabled, enqueueMonitoringEvent]
  );

  const handlePromptContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      if (!contextGuardEnabled) return;
      e.preventDefault();
      enqueueMonitoringEvent("CONTEXT_MENU_EVENT_OBSERVED", { scope: "question_prompt" });
    },
    [contextGuardEnabled, enqueueMonitoringEvent]
  );

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
    <div className="relative min-h-screen bg-slate-50 pb-28 lg:pb-12">
      <StudentExamWatermark
        enabled={securityPolicy?.watermarkEnabled ?? true}
        opacity={securityPolicy?.watermarkOpacity ?? 0.08}
        studentName={studentDisplayName}
        attemptId={attemptId}
      />
      {/* Sticky Focused Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs shadow-xs">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-2 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                {initialWorkspace.examTitle}
              </p>
              <p className="truncate text-xs text-slate-600">
                {initialWorkspace.subjectName} • Percobaan {initialWorkspace.attempt.attemptNumber}
              </p>
            </div>

            {/* Authoritative Server Timer */}
            <ExamCountdownBadge
              initialRemainingMs={initialWorkspace.remainingMs}
              deadlineMs={deadlineMs}
              clockOffsetMsRef={clockOffsetMsRef}
              attemptStatus={attemptStatus}
              onExpire={syncServerClock}
            />
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-xs">
            <div className="flex items-center gap-2">
              {/* Network Status */}
              <Badge
                variant={isOnline ? "success" : "warning"}
                className="flex items-center gap-1 py-0.5 text-[11px]"
                aria-live="polite"
              >
                {isOnline ? (
                  <Wifi className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <WifiOff className="h-3 w-3" aria-hidden="true" />
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
                className="py-0.5 text-[11px]"
                aria-live="polite"
              >
                {badgeState}
                {pendingKeys.length > 0 ? ` (${pendingKeys.length})` : ""}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-600 text-[11px] font-medium hidden sm:inline">
                Terjawab <strong>{answeredCount}</strong>/{questions.length}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[32px] h-8 px-2.5 text-xs lg:hidden"
                onClick={() => setPaletteOpen(true)}
              >
                <Grid2x2 className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
                <span>
                  Soal {currentIdx + 1}/{questions.length}
                </span>
              </Button>
            </div>
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

          {focusNoticeCount > 0 ? (
            <Alert variant="info" title="Catatan Pemantauan Sesi">
              Perpindahan fokus tab atau aktivitas salin pada area soal tercatat sebagai informasi
              teknis sesi untuk pengawas ({focusNoticeCount} kejadian), tanpa menghentikan pengisian
              atau pengumpulan ujian Anda.
            </Alert>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Active Question Workspace */}
          <main className="space-y-4 pb-24 lg:pb-8">
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
                      className={cn(
                        "min-h-[38px] transition-all",
                        activeQuestion.isFlaggedForReview
                          ? "border-amber-400 bg-amber-50 text-amber-950 font-bold ring-1 ring-amber-400 hover:bg-amber-100"
                          : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      <Flag
                        className={cn(
                          "h-3.5 w-3.5",
                          activeQuestion.isFlaggedForReview
                            ? "fill-amber-500 text-amber-600"
                            : "text-slate-400"
                        )}
                        aria-hidden="true"
                      />
                      <span>
                        {activeQuestion.isFlaggedForReview ? "Ditandai Ragu" : "Tandai Ragu-ragu"}
                      </span>
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 pt-5">
                  <div
                    data-exam-prompt="true"
                    onCopy={handlePromptCopy}
                    onContextMenu={handlePromptContextMenu}
                    className={`text-base text-slate-900 ${copyGuardEnabled ? "select-none" : ""}`}
                  >
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
                              className={cn(
                                "flex min-h-[56px] cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition-all select-none",
                                isSelected
                                  ? "border-blue-600 bg-blue-50/80 ring-2 ring-blue-600 shadow-xs"
                                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                              )}
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
                                className="mt-1 h-4 w-4 text-blue-700 focus:ring-blue-600"
                              />
                              <span
                                className={cn(
                                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                                  isSelected
                                    ? "bg-blue-600 text-white"
                                    : "bg-slate-100 text-slate-800 border border-slate-200"
                                )}
                              >
                                {opt.optionKey}
                              </span>
                              <div className="min-w-0 flex-1 pt-0.5 text-sm sm:text-base leading-relaxed text-slate-900">
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
                          className="text-xs font-semibold text-slate-600 underline hover:text-slate-900 transition-colors py-1 inline-block"
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
                      className="space-y-3"
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
                            className={cn(
                              "flex min-h-[56px] cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition-all select-none",
                              isChecked
                                ? "border-blue-600 bg-blue-50/80 ring-2 ring-blue-600 shadow-xs"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                            )}
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
                              className="mt-1 h-4 w-4 rounded text-blue-700 focus:ring-blue-600"
                            />
                            <span
                              className={cn(
                                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold transition-colors",
                                isChecked
                                  ? "bg-blue-600 text-white"
                                  : "bg-slate-100 text-slate-800 border border-slate-200"
                              )}
                            >
                              {opt.optionKey}
                            </span>
                            <div className="min-w-0 flex-1 pt-0.5 text-sm sm:text-base leading-relaxed text-slate-900">
                              <QuestionContentRenderer content={opt.optionText} />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Essay */}
                  {activeQuestion.questionType === "essay" && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <label
                          htmlFor={`essay-${activeQuestion.attemptQuestionId}`}
                          className="font-medium text-slate-700"
                        >
                          Jawaban Esai Anda
                        </label>
                        <span className="font-mono text-slate-500">
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
                        className="text-base leading-relaxed min-h-[160px] p-4"
                      />
                      <p className="text-[11px] text-slate-500 italic">
                        Jawaban esai tersimpan otomatis setiap selesai mengetik atau berpindah nomor soal.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {/* Unified Responsive Question Navigation Footer: sticky on mobile, static card on desktop */}
            <div className="fixed inset-x-0 bottom-0 z-30 lg:static border-t lg:border border-slate-200 bg-white/95 p-3 sm:p-4 backdrop-blur-sm pb-safe lg:pb-4 lg:rounded-xl shadow-lg lg:shadow-xs flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={currentIdx === 0}
                onClick={() => void switchQuestion(Math.max(0, currentIdx - 1))}
                className="min-h-[44px] px-3 sm:px-4 font-semibold text-xs sm:text-sm"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span>Sebelumnya</span>
              </Button>

              {/* Mobile Palette Trigger (center on mobile) */}
              <div className="lg:hidden">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPaletteOpen(true)}
                  className="min-h-[44px] px-3 text-xs sm:text-sm border border-slate-200 font-semibold"
                >
                  <Grid2x2 className="h-4 w-4 text-blue-700" aria-hidden="true" />
                  <span>
                    Soal {currentIdx + 1}/{questions.length}
                  </span>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                {currentIdx < questions.length - 1 ? (
                  <Button
                    type="button"
                    onClick={() => void switchQuestion(Math.min(questions.length - 1, currentIdx + 1))}
                    className="min-h-[44px] px-4 font-semibold text-xs sm:text-sm"
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
                    className="min-h-[44px] bg-emerald-700 text-white hover:bg-emerald-800 px-4 font-semibold text-xs sm:text-sm"
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

      {/* Mobile Palette Overlay Modal */}
      {paletteOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigasi nomor soal"
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 lg:hidden"
        >
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={() => setPaletteOpen(false)}
            aria-hidden="true"
          />

          <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl pb-safe shadow-2xl animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Daftar Nomor Soal</h2>
                <p className="text-xs text-slate-600">
                  Terjawab <strong>{answeredCount}</strong>/{questions.length} • Ragu{" "}
                  <strong>{flaggedCount}</strong>
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup daftar soal"
                onClick={() => setPaletteOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2.5 py-4">
              {questions.map((q, idx) => {
                const answered = hasFilledAnswer(q.currentResponse);
                const flagged = q.isFlaggedForReview;
                const active = idx === currentIdx;

                let styleClass = "border-slate-200 bg-white text-slate-700";
                if (flagged) {
                  styleClass = "border-amber-400 bg-amber-100 text-amber-950 font-bold";
                } else if (answered) {
                  styleClass = "border-emerald-500 bg-emerald-50 text-emerald-950 font-bold";
                }

                return (
                  <button
                    key={q.attemptQuestionId}
                    type="button"
                    onClick={() => {
                      void switchQuestion(idx);
                      setPaletteOpen(false);
                    }}
                    className={cn(
                      "flex h-12 items-center justify-center rounded-xl border text-sm font-semibold transition-all select-none",
                      styleClass,
                      active ? "ring-2 ring-blue-700 ring-offset-1" : ""
                    )}
                  >
                    {q.displayIndex}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="space-y-1.5 border-t border-slate-100 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded border border-emerald-500 bg-emerald-50" />
                <span>Sudah dijawab</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded border border-amber-400 bg-amber-100" />
                <span>Ditandai ragu-ragu</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded border border-slate-200 bg-white" />
                <span>Belum dijawab</span>
              </div>
            </div>

            <Button
              type="button"
              className="w-full min-h-[44px]"
              disabled={navigatingToReview}
              onClick={() => void handleGoToReview()}
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <span>Tinjau Jawaban &amp; Kumpulkan</span>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
