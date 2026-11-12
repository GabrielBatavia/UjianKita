# Exam Attempt Lifecycle & Transactional Finalization

UjianKita explicitly separates **attempt execution lifecycle**, **grading status**, and **result release visibility** in `src/domain/exams/contracts.ts` and `supabase/migrations/20261112000006_phase3_attempt_and_grading_schema.sql`.

---

## 1. Three Orthogonal State Machines

### Attempt Execution Lifecycle (`AttemptLifecycleStatus`)
- `NOT_STARTED` -> pre-start state
- `IN_PROGRESS` -> active exam session with ticking server deadline (`idx_exam_attempts_single_active` permits at most one active `IN_PROGRESS`/`SUBMITTING` attempt per `(exam_id, student_id)`)
- `SUBMITTING` -> intermediate transitional state prior to commit
- `SUBMITTED` -> finalized explicitly by student submission (**terminal**, immutable via `trg_guard_finalized_exam_attempts`)
- `EXPIRED` -> finalized automatically by server deadline enforcement (**terminal**)
- `CANCELLED_BY_ADMIN` -> invalidated administratively with mandatory audit reason (`cancel_exam_attempt_by_admin`) (**terminal**)

### Grading Lifecycle (`GradingStatus`)
- `PENDING_OBJECTIVE` -> queued prior to grading engine execution
- `PENDING_MANUAL_REVIEW` -> objective items auto-scored; one or more `essay`/`manual_rubric` questions await teacher scoring
- `GRADED` -> all objective and manual items finalized
- `ADJUSTED` -> teacher/coordinator applied an audited manual adjustment (`grade_adjustments`)

### Result Release Lifecycle (`ResultReleaseStatus`)
- `UNRELEASED` -> student sees only the submission receipt, never score/pass status
- `RELEASED` -> student can inspect score breakdown according to `exams.result_release_policy` (`manual`, `after_submit_if_no_essay`, or `after_window_close`) and `allow_student_review`

---

## 2. Separated Navigation, Review & Submission Flow

1. **Question Navigation:** `Sebelumnya`, `Berikutnya`, and the question palette **never** submit an attempt.
2. **Pre-Submit Review Screen (`/student/attempts/[attemptId]/review`):**
   - Flushes any remaining pending local drafts from `IndexedDB`.
   - Displays summary counts (`Terjawab`, `Belum Dijawab`, `Ditandai Ragu-ragu`) and direct `Kembali` deep links to any specific question (`?q=...`).
   - Requires explicit dialog confirmation with unanswered-question acknowledgment (`confirmedUnansweredAck`) before issuing `POST /api/student/attempts/[attemptId]/submit`.

---

## 3. Atomic Submission & Receipt Generation (`_finalize_attempt_internal`)

Triggered by student confirmation (`submit_exam_attempt_atomic`), lazy deadline access (`finalize_expired_attempt_on_access`), or background sweep (`finalize_expired_exam_attempts`):

1. Acquires row lock `FOR UPDATE` on `exam_attempts`.
2. Returns existing finalized receipt cleanly on retry when already `SUBMITTED`/`EXPIRED` (`idempotent: true` / `SUBMITTED` or `EXPIRED` handling).
3. Rejects cancelled attempts (`ATTEMPT_CANCELLED`).
4. Transitions attempt status to `SUBMITTED` (or `EXPIRED` when server UTC clock exceeded `deadline_at_utc`).
5. Inserts immutable `exam_submissions` row and immutable `submission_receipts` row (`receipt_code` + SHA integrity digest) — protected against `UPDATE`/`DELETE` by `trg_exam_submissions_immutable` and `trg_submission_receipts_immutable`.
6. Triggers immediate server-side objective grading via `_compute_and_upsert_exam_grade` and applies auto-release rules only when `result_release_policy = 'after_submit_if_no_essay'` and `pending_manual_count = 0`.
7. Once finalized, `trg_guard_finalized_student_answers` blocks any subsequent insert/update/delete on `student_answers` for that attempt.

---

## 4. Client Telemetry & Trust Boundaries (`attempt_events`)

All monitoring events stored in `attempt_events` record an explicit `event_source`:
- `server_confirmed` — attempt start, submission, expiration, release, admin cancellation
- `client_reported` — `PAGE_HIDDEN`, `PAGE_VISIBLE`, `FULLSCREEN_EXIT`, `CONNECTION_RESTORED`, `STORAGE_WARNING` (logged via `POST /api/student/attempts/[attemptId]/events`, rate-limited at 60/min per user; treated as untrusted advisory telemetry)
- `server_inferred` — server-detected anomalies
