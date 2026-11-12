# Idempotent Answer Persistence & Local Recovery Queue

UjianKita separates **unconfirmed local buffering** from **server-confirmed PostgreSQL persistence** so transient cellular/Wi-Fi drops during ~100-student exam sessions neither silently lose answers nor mislead students into thinking unpersisted edits are safe.

---

## 1. Local Recovery Queue (`src/lib/exam-storage.ts`)

- **Primary Store:** Browser `IndexedDB` (`ujiankita_exam_queue_v1`, object store `pending_answers` keyed by `[attemptId, attemptQuestionId]` with index `by_attempt`).
- **Private Browsing / Quota Fallback:** When `IndexedDB` is blocked or throws, `probeExamLocalStorageHealth()` detects `memory_only` mode and `ExamPlayerClient` displays an explicit Bahasa Indonesia warning banner instructing the student not to close or refresh the browser until every answer reads `Tersimpan`.
- **Canonical Client Hashing:** `computeClientPayloadHash()` sorts `multiple_choice` `selectedOptionKeys` lexicographically before hashing (`SHA-256` via Web Crypto when available, deterministic fallback otherwise), matching server `computeAnswerPayloadHash()` in `src/services/attempt-service.ts`.

---

## 2. Explicit UI Synchronization States (`exam-player-client.tsx`)

Students always see the exact persistence truth in the top header and question navigator badges:

| Condition | UI Status Badge | Meaning |
|---|---|---|
| `!isOnline` | `Menunggu koneksi` | Device offline; changes remain safely buffered locally in `IndexedDB` |
| `inFlightCount > 0` | `Menyimpan...` | `PUT /api/student/attempts/[attemptId]/answers` request in flight |
| `hasFailedSave` | `Gagal menyimpan` | Server returned an error; manual retry CTA shown (`Coba Kirim Sekarang` / `Coba Lagi`) |
| `pendingKeys.length > 0` | `Sinkronisasi diperlukan` | Local drafts await server confirmation (flushed on reconnect and every 10s interval) |
| `pendingKeys.length === 0 && !hasFailedSave` | `Tersimpan` | Shown **only** after `COMMITTED` or `IDEMPOTENT_REPLAY` acknowledgment from PostgreSQL |

- **Debounced Essay Persistence:** Typing in an `essay` textarea waits `600ms` before flushing to `/answers`, and flushes immediately (`flushCurrentEssayIfPending`) when navigating away from a question or entering `/review`.
- **Question Flagging:** `PATCH /api/student/attempts/[attemptId]/flag` toggles `is_flagged_for_review` safely without overwriting the student's committed answer text/options.

---

## 3. Monotonic Revision & Idempotency Protocol (`save_attempt_answer_atomic`)

Every write payload validated by `saveAnswerSchema` (`src/schemas/attempts.ts`) carries:
- `attemptQuestionId` (UUID)
- `idempotencyKey` (client-generated UUID per edit revision)
- `clientRevision` (strictly increasing integer per question within an attempt)
- `responsePayload` (`single_choice`, `multiple_choice`, `true_false`, or `essay`)

Inside PostgreSQL (`save_attempt_answer_atomic` in `supabase/migrations/20261112000007_phase3_rls_and_attempt_rpcs.sql`), executing under row lock on `exam_attempts` (`FOR UPDATE`):

1. **Lifecycle & Deadline Check:**
   - Rejects finalized attempts -> `ATTEMPT_ALREADY_SUBMITTED` (`409`) or `ATTEMPT_CANCELLED` (`403`).
   - If `now_utc > deadline_at_utc`, auto-finalizes the attempt cleanly and returns `DEADLINE_EXPIRED` (`410`).
2. **Option Display-Key -> Canonical-Key Normalization:**
   - Translates display option keys (`A`, `B`, ...) back to canonical `exam_version_answer_keys` keys via `attempt_question_assignments.option_order_map`, storing both normalized display selection and canonical keys inside `student_answers.response_payload`.
3. **Idempotency Replay / Conflict Check (`answer_save_requests`):**
   - Same `(attempt_id, idempotency_key)` + same `request_hash` -> returns `IDEMPOTENT_REPLAY` (`200`) without duplicating rows.
   - Same `(attempt_id, idempotency_key)` + different `request_hash` -> returns `IDEMPOTENCY_CONFLICT` (`409`).
4. **Monotonic Revision Check (`student_answers.latest_revision`):**
   - If `p_client_revision <= current.latest_revision` -> returns `STALE_REVISION_REJECTED` (`409`) with `authoritativeRevision`, preserving newer server state; the client drops the stale local draft on receipt.
   - If `p_client_revision > current.latest_revision` -> upserts `student_answers`, inserts an immutable audit revision into `answer_revisions`, records `answer_save_requests`, updates `exam_attempts.last_activity_at_utc`, and returns `COMMITTED` (`200`).
