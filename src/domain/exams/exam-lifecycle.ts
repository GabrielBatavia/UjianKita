import { createHash } from "node:crypto";
import type {
  ExamClassAssignmentItem,
  ExamDraftQuestionItem,
  ExamRecord,
  ExamScheduleItem,
  ExamStatus,
} from "@/domain/exams/phase2-types";

const ALLOWED_EXAM_TRANSITIONS: Readonly<Record<ExamStatus, readonly ExamStatus[]>> = {
  DRAFT: ["READY_FOR_REVIEW", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["CLOSED", "ARCHIVED", "DRAFT"], // PUBLISHED -> DRAFT only via explicit revision flow
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionExamStatus(from: ExamStatus, to: ExamStatus): boolean {
  return ALLOWED_EXAM_TRANSITIONS[from].includes(to);
}

export function isExamEditable(status: ExamStatus): boolean {
  return status === "DRAFT" || status === "READY_FOR_REVIEW";
}

export interface ExamChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ExamReadinessValidation {
  ready: boolean;
  totalQuestions: number;
  totalPoints: number;
  checklist: ExamChecklistItem[];
}

export function validateExamReadiness(params: {
  exam: ExamRecord;
  draftQuestions: ExamDraftQuestionItem[];
  assignments: ExamClassAssignmentItem[];
}): ExamReadinessValidation {
  const { exam, draftQuestions, assignments } = params;

  const activeQuestions = draftQuestions.filter(
    (dq) => dq.question.status !== "archived" && dq.question.current_version !== null
  );
  const archivedOrIncompleteCount = draftQuestions.length - activeQuestions.length;

  const totalPoints = activeQuestions.reduce(
    (sum, dq) => sum + Number(dq.points_override ?? dq.question.current_version?.points ?? 0),
    0
  );

  const missingKeyCount = activeQuestions.filter((dq) => {
    const ver = dq.question.current_version;
    if (!ver) return true;
    if (dq.question.question_type === "essay") return false;
    return ver.correct_option_keys.length < 1;
  }).length;

  const hasValidWindow =
    Boolean(exam.starts_at) &&
    Boolean(exam.ends_at) &&
    new Date(exam.ends_at!).getTime() > new Date(exam.starts_at!).getTime();

  const windowSpanMinutes = hasValidWindow
    ? (new Date(exam.ends_at!).getTime() - new Date(exam.starts_at!).getTime()) / 60_000
    : 0;

  const checklist: ExamChecklistItem[] = [
    {
      id: "has-questions",
      label: "Minimal 1 soal valid terpasang",
      passed: activeQuestions.length >= 1 && archivedOrIncompleteCount === 0,
      detail:
        archivedOrIncompleteCount > 0
          ? `Terdapat ${archivedOrIncompleteCount} soal arsip atau belum lengkap yang harus dihapus dari draf.`
          : `${activeQuestions.length} soal siap diujikan.`,
    },
    {
      id: "answer-keys",
      label: "Semua soal objektif memiliki kunci jawaban",
      passed: activeQuestions.length > 0 && missingKeyCount === 0,
      detail:
        missingKeyCount > 0
          ? `${missingKeyCount} soal objektif belum memiliki kunci jawaban.`
          : "Seluruh kunci jawaban terverifikasi.",
    },
    {
      id: "total-points",
      label: "Total poin & nilai ketuntasan konsisten",
      passed: totalPoints > 0 && exam.passing_score <= totalPoints,
      detail: `Total poin ${totalPoints}, batas ketuntasan ${exam.passing_score}.`,
    },
    {
      id: "schedule-window",
      label: "Jendela waktu mulai & selesai valid",
      passed: hasValidWindow && windowSpanMinutes >= exam.duration_minutes,
      detail: !hasValidWindow
        ? "Tanggal/waktu mulai dan selesai belum diisi dengan benar."
        : windowSpanMinutes < exam.duration_minutes
          ? `Rentang waktu jendela (${Math.floor(windowSpanMinutes)} menit) lebih pendek dari durasi ujian (${exam.duration_minutes} menit).`
          : `Durasi ${exam.duration_minutes} menit dalam jendela waktu yang valid.`,
    },
    {
      id: "assigned-classes",
      label: "Minimal 1 kelas peserta ditetapkan",
      passed: assignments.length >= 1,
      detail:
        assignments.length >= 1
          ? `${assignments.length} kelas ditugaskan.`
          : "Belum ada kelas yang dipilih untuk ujian ini.",
    },
  ];

  return {
    ready: checklist.every((c) => c.passed),
    totalQuestions: activeQuestions.length,
    totalPoints,
    checklist,
  };
}

export interface ScheduleConflictWarning {
  classId: string;
  className: string;
  conflictingExamId: string;
  conflictingExamTitle: string;
  startsAt: string;
  endsAt: string;
}

export function detectScheduleConflicts(params: {
  examId: string;
  startsAt: string | null;
  endsAt: string | null;
  assignedClassIds: string[];
  schoolSchedules: ExamScheduleItem[];
}): ScheduleConflictWarning[] {
  if (!params.startsAt || !params.endsAt || params.assignedClassIds.length === 0) {
    return [];
  }

  const startMs = new Date(params.startsAt).getTime();
  const endMs = new Date(params.endsAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return [];
  }

  const classSet = new Set(params.assignedClassIds);
  const warnings: ScheduleConflictWarning[] = [];

  for (const sched of params.schoolSchedules) {
    if (sched.exam_id === params.examId) continue;
    if (!classSet.has(sched.class_id)) continue;
    if (sched.exam_status === "ARCHIVED" || sched.exam_status === "CLOSED") continue;

    const otherStart = new Date(sched.starts_at).getTime();
    const otherEnd = new Date(sched.ends_at).getTime();
    const overlaps = startMs < otherEnd && endMs > otherStart;

    if (overlaps) {
      warnings.push({
        classId: sched.class_id,
        className: sched.class_name,
        conflictingExamId: sched.exam_id,
        conflictingExamTitle: sched.exam_title ?? "Ujian lain",
        startsAt: sched.starts_at,
        endsAt: sched.ends_at,
      });
    }
  }

  return warnings;
}

/**
 * Computes a deterministic 32-bit seed from attemptId + examVersionId for repeatable
 * per-attempt randomization in Phase 3 (refreshing never reshuffles).
 */
export function computeDeterministicShuffleSeed(attemptId: string, examVersionId: string): number {
  const hash = createHash("sha256").update(`${attemptId}:${examVersionId}`).digest();
  return hash.readUInt32BE(0);
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic shuffle respecting pinned items (where preserveOrder = true).
 */
export function deterministicShuffleWithPins<T>(
  items: readonly T[],
  seed: number,
  isPinned: (item: T) => boolean
): T[] {
  const result = [...items];
  const unpinnedIndices: number[] = [];

  for (let i = 0; i < result.length; i += 1) {
    const item = result[i];
    if (item !== undefined && !isPinned(item)) {
      unpinnedIndices.push(i);
    }
  }

  const rand = createMulberry32(seed);
  for (let i = unpinnedIndices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const idxA = unpinnedIndices[i];
    const idxB = unpinnedIndices[j];
    if (idxA !== undefined && idxB !== undefined) {
      const tmp = result[idxA]!;
      result[idxA] = result[idxB]!;
      result[idxB] = tmp;
    }
  }

  return result;
}
