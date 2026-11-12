"use client";

import type {
  PendingAnswerQueueItem,
  StudentResponsePayload,
} from "@/domain/exams/phase3-types";

const DB_NAME = "ujiankita_exam_queue_v1";
const DB_VERSION = 1;
const STORE_NAME = "pending_answers";

const memoryFallbackStore = new Map<string, PendingAnswerQueueItem>();

function makeMemoryKey(attemptId: string, attemptQuestionId: string): string {
  return `${attemptId}::${attemptQuestionId}`;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("INDEXED_DB_UNAVAILABLE"));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ["attemptId", "attemptQuestionId"],
        });
        store.createIndex("by_attempt", "attemptId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
  });
}

export async function probeExamLocalStorageHealth(): Promise<{
  storageOk: boolean;
  storageMode: "indexeddb" | "memory_only";
  warning: string | null;
}> {
  if (!canUseIndexedDb()) {
    return {
      storageOk: false,
      storageMode: "memory_only",
      warning:
        "Penyimpanan lokal IndexedDB tidak tersedia di browser ini. Jangan tutup atau refresh halaman sampai status menjadi Tersimpan.",
    };
  }

  try {
    const db = await openQueueDb();
    db.close();
    return {
      storageOk: true,
      storageMode: "indexeddb",
      warning: null,
    };
  } catch {
    return {
      storageOk: false,
      storageMode: "memory_only",
      warning:
        "Mode privat atau kuota penyimpanan browser membatasi IndexedDB. Jawaban tetap disinkronkan langsung ke server saat online.",
    };
  }
}

export async function computeClientPayloadHash(
  attemptQuestionId: string,
  payload: StudentResponsePayload
): Promise<string> {
  const canonical =
    payload.questionType === "multiple_choice"
      ? {
          attemptQuestionId,
          questionType: payload.questionType,
          selectedOptionKeys: [...payload.selectedOptionKeys].sort(),
        }
      : payload.questionType === "essay"
        ? {
            attemptQuestionId,
            questionType: payload.questionType,
            textAnswer: payload.textAnswer,
          }
        : {
            attemptQuestionId,
            questionType: payload.questionType,
            selectedOptionKey: payload.selectedOptionKey,
          };

  const text = JSON.stringify(canonical);
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Deterministic lightweight non-crypto fallback when crypto.subtle is unavailable
  let acc = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    acc ^= text.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return `fnv1a_${(acc >>> 0).toString(16)}`;
}

export function generateClientUuid(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function upsertPendingAnswerDraft(
  item: PendingAnswerQueueItem
): Promise<{ persistedToIndexedDb: boolean; error?: string }> {
  memoryFallbackStore.set(makeMemoryKey(item.attemptId, item.attemptQuestionId), item);

  if (!canUseIndexedDb()) {
    return { persistedToIndexedDb: false, error: "IndexedDB tidak tersedia" };
  }

  try {
    const db = await openQueueDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("INDEXED_DB_WRITE_FAILED"));
      tx.onabort = () => reject(tx.error ?? new Error("INDEXED_DB_WRITE_ABORTED"));
    });
    db.close();
    return { persistedToIndexedDb: true };
  } catch (err) {
    return {
      persistedToIndexedDb: false,
      error: err instanceof Error ? err.message : "Gagal menyimpan draf lokal",
    };
  }
}

export async function removePendingAnswerDraft(
  attemptId: string,
  attemptQuestionId: string
): Promise<void> {
  memoryFallbackStore.delete(makeMemoryKey(attemptId, attemptQuestionId));

  if (!canUseIndexedDb()) return;
  try {
    const db = await openQueueDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete([attemptId, attemptQuestionId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Graceful no-op fallback
  }
}

export async function listPendingAnswerDrafts(
  attemptId: string
): Promise<PendingAnswerQueueItem[]> {
  const fromMemory = Array.from(memoryFallbackStore.values()).filter(
    (item) => item.attemptId === attemptId
  );

  if (!canUseIndexedDb()) {
    return fromMemory.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  }

  try {
    const db = await openQueueDb();
    const idbItems = await new Promise<PendingAnswerQueueItem[]>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const idx = tx.objectStore(STORE_NAME).index("by_attempt");
      const req = idx.getAll(IDBKeyRange.only(attemptId));
      req.onsuccess = () => resolve((req.result ?? []) as PendingAnswerQueueItem[]);
      req.onerror = () => resolve([]);
    });
    db.close();

    const merged = new Map<string, PendingAnswerQueueItem>();
    for (const item of idbItems) {
      merged.set(item.attemptQuestionId, item);
    }
    for (const mem of fromMemory) {
      const existing = merged.get(mem.attemptQuestionId);
      if (!existing || mem.clientRevision > existing.clientRevision) {
        merged.set(mem.attemptQuestionId, mem);
      }
    }
    return Array.from(merged.values()).sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  } catch {
    return fromMemory.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  }
}

export async function clearAttemptPendingDrafts(attemptId: string): Promise<void> {
  for (const key of Array.from(memoryFallbackStore.keys())) {
    if (key.startsWith(`${attemptId}::`)) {
      memoryFallbackStore.delete(key);
    }
  }

  if (!canUseIndexedDb()) return;
  try {
    const db = await openQueueDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index("by_attempt");
      const req = idx.getAllKeys(IDBKeyRange.only(attemptId));
      req.onsuccess = () => {
        for (const k of req.result ?? []) {
          store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Graceful no-op fallback
  }
}

export function resetMemoryDraftQueueForTests(): void {
  memoryFallbackStore.clear();
}
