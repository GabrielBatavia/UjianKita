# Student Examination Engine

**UjianKita Phase 3** delivers the authoritative server-controlled student examination workspace, eligibility classification, deterministic question/option realization, and fail-closed security isolation across mobile (ExamBro Android / SEB iOS) and desktop browsers.

---

## 1. Routes & Components

### Student Portal Routes (`src/app/(portal)/student/`)
- `/student` — Student summary dashboard linking to `/student/exams` and `/student/results`
- `/student/exams` (`src/components/features/student/student-exams-catalog.tsx`) — Server-classified exam catalog grouped into **Sedang Berlangsung**, **Siap Dikerjakan**, **Akan Datang**, **Selesai**, **Kedaluwarsa**, and **Tidak Tersedia**
- `/student/exams/[examId]` and `/student/exams/[examId]/instructions` (`src/components/features/student/student-exam-instructions.tsx`) — Preflight verification, schedule/attempt quota summary, IndexedDB health check, and idempotent exam start/resume trigger
- `/student/attempts/[attemptId]` (`src/components/features/student/exam-player-client.tsx`) — Distraction-free active exam workspace (`PortalShell` chrome suppressed on `/student/attempts/*` execution/review routes)
- `/student/attempts/[attemptId]/review` (`src/components/features/student/student-attempt-review.tsx`) — Dedicated pre-submission review checklist (answered, unanswered, flagged-for-review, local-pending flush, explicit modal confirmation)
- `/student/attempts/[attemptId]/receipt` (`src/components/features/student/student-submission-receipt.tsx`) — Immutable submission proof (`receipt_code`, `integrity_digest`, timestamps)
- `/student/results` (`/student/history` redirects here; `src/components/features/student/student-results-list.tsx`) — Decoupled result view displaying score breakdowns only when released according to policy

### Student REST APIs (`src/app/api/student/`)
All handlers verify sessions through `requireRoleActor("student")`, apply user-scoped sliding-window throttling (`enforceActorRateLimit`) so 100 NAT students behind a shared school Wi-Fi IP do not collide, and respond exclusively with `Cache-Control: no-store, no-cache, must-revalidate, private` via `noStoreJson()`:
- `GET /api/student/exams`
- `GET /api/student/exams/[examId]`
- `POST /api/student/exams/[examId]/start`
- `GET /api/student/attempts/[attemptId]`
- `GET /api/student/attempts/[attemptId]/time`
- `PUT /api/student/attempts/[attemptId]/answers`
- `PATCH /api/student/attempts/[attemptId]/flag`
- `POST /api/student/attempts/[attemptId]/events`
- `POST /api/student/attempts/[attemptId]/submit`
- `GET /api/student/attempts/[attemptId]/receipt`
- `GET /api/student/results`

---

## 2. Server-Side Eligibility & Authoritative Timing (`src/domain/exams/eligibility.ts`)

Access eligibility and countdown deadlines are never trusted from the browser clock:

1. **Schedule & Enrollment Verification:** Student must hold an active enrollment (`class_enrollments.status = 'active'`) in a class assigned via `exam_assignments` and `exam_schedules`, and the exam must be `PUBLISHED` (or `CLOSED` when reviewing historical receipts/results).
2. **`classifyStudentExamEligibility()`** evaluates categories deterministically against `nowUtcMs`:
   - `RESUME_IN_PROGRESS` -> `sedang_berlangsung` (`canResume: true`) when an open attempt exists and `nowUtcMs <= deadlineAtUtc`.
   - `ATTEMPT_LIMIT_REACHED` -> `selesai` (`canViewReceipt: true`) when `attemptsUsed >= maxAttempts`.
   - `BEFORE_WINDOW` -> `akan_datang` when `nowUtcMs < startsAtUtc`.
   - `LATE_JOIN_EXPIRED` -> `kedaluwarsa` when `lateJoinMinutes > 0` and `nowUtcMs > startsAtUtc + lateJoinMinutes * 60_000`.
   - `WINDOW_ENDED` -> `kedaluwarsa` when `nowUtcMs >= endsAtUtc`.
   - `ELIGIBLE_TO_START` -> `siap_dikerjakan` (`canStart: true`).
3. **Attempt Deadline Calculation (`computeAttemptDeadlineUtcMs`):**
   ```text
   effectiveDeadlineUtc = min(
     startedAtUtc + (durationMinutes + timeExtensionMinutes) * 60_000,
     windowEndsAtUtc   // if configured
   )
   ```
   - `GET /api/student/attempts/[attemptId]/time` synchronizes `serverNowUtc`, `deadlineAtUtc`, `remainingMs`, and `status` every 45 seconds and on reload, computing client drift locally via `clockOffsetMsRef` (`serverNowUtc - Date.now()`).

---

## 3. Deterministic Attempt Snapshot & Answer Key Isolation

When `start_or_resume_exam_attempt(p_exam_id, p_start_idempotency_key, p_client_timezone)` executes:
1. If an active attempt already exists (`status IN ('IN_PROGRESS', 'SUBMITTING')`), it is resumed without regenerating question order — enforced uniquely by `idx_exam_attempts_single_active`.
2. When starting a new attempt:
   - Reads the frozen `exam_versions` and `exam_version_questions` rows (never live editable `questions`).
   - Deterministically orders questions (respecting `preserve_question_position` pins) and shuffles options (respecting `preserve_option_order`) seeded cleanly by `(attempt_id / student_id / exam_version_id)`.
   - Inserts `attempt_question_assignments` containing only student-safe prompt snapshots (`stem_snapshot`, `points_snapshot`, display `options_snapshot`, and server-only `option_order_map` mapping randomized display keys back to canonical option keys).
   - **Students have zero RLS policies and zero API projections reading `question_answer_keys`, `exam_version_answer_keys`, `exam_version_questions`, explanations, or grading rubrics during an active attempt.**
