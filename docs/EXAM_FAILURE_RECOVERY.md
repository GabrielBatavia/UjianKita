# Exam Failure Mode Analysis & Recovery Design

UjianKita is engineered to handle failure modes encountered across ~100 simultaneous school students taking exams on smartphones (ExamBro Android / SEB iOS) over congested classroom Wi-Fi or cellular networks.

> **Verification Honesty Note:** While client recovery logic, server service-boundary rules, and idempotency/monotonic revision handlers are verified by automated offline unit and mocked integration tests, **live PostgreSQL transactional execution and high-concurrency load stress runs (`scripts/load-test-exam-engine.ts`) remain pending live/isolated PostgreSQL connectivity.**

---

## 1. Failure Scenario Recovery Matrix

| Failure Scenario | Protection / Recovery Mechanism | Source Layer |
|---|---|---|
| **Browser crash or accidental refresh mid-exam** | Reloading `/student/exams/[examId]/instructions` or `/student/attempts/[attemptId]` invokes `start_or_resume_exam_attempt`, resuming the existing `IN_PROGRESS` attempt with frozen question/option order (`idx_exam_attempts_single_active`). `ExamPlayerClient` merges any newer unconfirmed local `IndexedDB` drafts over committed `student_answers` on mount and immediately resyncs the authoritative timer via `GET /time`. | PostgreSQL + `exam-player-client.tsx` + `exam-storage.ts` |
| **Temporary cellular or Wi-Fi drop** | `ExamPlayerClient` immediately buffers responses into `IndexedDB` (`pending_answers`), clears `"Tersimpan"`, and displays `"Menunggu koneksi"`. On the browser `"online"` event, 10s periodic background loop, or manual `"Coba Kirim Sekarang"`, pending drafts flush FIFO using each item's original `idempotencyKey`. | `exam-player-client.tsx` + `exam-storage.ts` |
| **Duplicate `start` clicks or concurrent tab opens** | `idx_exam_attempts_single_active` + `uq_exam_attempts_start_key` prevent creating duplicate active attempts; calling `start_or_resume_exam_attempt` returns the existing attempt with `resumed: true`. | PostgreSQL migration `000007` |
| **Out-of-order / delayed HTTP `PUT /answers` retry** | Server checks `p_client_revision <= current.latest_revision` and rejects stale writes with `409 STALE_REVISION_REJECTED`, returning `authoritativeRevision` so the client drops outdated local queue entries without clobbering newer answers. | `save_attempt_answer_atomic` + `exam-player-client.tsx` |
| **Duplicate HTTP retry after timeout** | Matching `(attempt_id, idempotency_key)` + identical `request_hash` in `answer_save_requests` returns `200 IDEMPOTENT_REPLAY` without double-writing revisions; mismatched payload hashes fail closed with `409 IDEMPOTENCY_CONFLICT`. | `save_attempt_answer_atomic` + `attempt-service.ts` |
| **Student double-clicks Submit button** | Client generates a single `submitIdempotencyKey` per review screen session and disables the confirm CTA while submitting; PostgreSQL locks `exam_attempts FOR UPDATE` in `_finalize_attempt_internal`, returning the identical immutable `SubmissionReceipt` cleanly on replay. | `student-attempt-review.tsx` + `_finalize_attempt_internal` |
| **Deadline expires while offline or tab closed** | Server rejects late saves with `410 DEADLINE_EXPIRED` and auto-finalizes the attempt as `EXPIRED`. Any subsequent access (`finalize_expired_attempt_on_access`) or batch worker sweep (`finalize_expired_exam_attempts`) commits final `student_answers` snapshots, issues a receipt, and runs objective grading. | `000007` RPCs + `attempt-service.ts` |
| **IndexedDB disabled (private mode / quota exceeded)** | `probeExamLocalStorageHealth()` falls back gracefully to an in-memory map (`memory_only` mode) and renders a persistent warning banner alerting the student not to refresh/close until status confirms `"Tersimpan"`. | `exam-storage.ts` + `exam-player-client.tsx` |
| **Student clock skewed ahead or behind** | `ExamPlayerClient` never computes end-of-exam eligibility from wall clock alone; `clockOffsetMsRef = serverNowUtc - Date.now()` re-syncs every 45s via `GET /time`, and final enforcement happens exclusively inside PostgreSQL UTC comparisons (`timezone('utc', now())`). | `exam-player-client.tsx` + `000007` RPCs |
| **Administrator emergency invalidation** | Authorized school admins can cancel active/non-finalized attempts via `POST /api/admin/attempts/[attemptId]/cancel` (`cancel_exam_attempt_by_admin`), transitioning status to `CANCELLED_BY_ADMIN` with mandatory audit reason (`>= 5` chars) and logging `attempt.cancelled`. | `admin-exam-detail.tsx` + `grading-service.ts` + `000007` |

---

## 2. Reproducible 100-Student Load & Stress Harness (`scripts/load-test-exam-engine.ts`)

`scripts/load-test-exam-engine.ts` simulates up to 100 simultaneous virtual students executing staggered starts, answer autosaves, intentional duplicate-idempotency-key retries on question 1, and final submissions against an isolated test environment:

```bash
LOAD_TEST_CONFIRM_ISOLATED=true \
TARGET_BASE_URL=http://127.0.0.1:3000 \
LOAD_TEST_EXAM_ID=<exam-uuid> \
LOAD_TEST_TOKENS_JSON='[{"cookie":"sb-..."}]' \
LOAD_TEST_QUESTIONS_PER_STUDENT=20 \
npx tsx scripts/load-test-exam-engine.ts
```

- **Safety Guard:** Refuses to run unless `LOAD_TEST_CONFIRM_ISOLATED=true` is explicitly provided so shared or production instances cannot be targeted accidentally.
- Reports p50/p95/p99 latency breakdown across `start`, `save`, and `submit` plus non-zero exit code on any HTTP error or duplicate submission inconsistency.
