# Examination Lifecycle & Immutable Publishing (Phase 2 -> Phase 3 Contract)

Every examination in UjianKita follows a strict server-controlled state machine culminating in an immutable published snapshot ready for student delivery in Phase 3.

---

## 1. Status State Machine

Defined in `src/domain/exams/exam-lifecycle.ts` (`ALLOWED_EXAM_TRANSITIONS` and `canTransitionExamStatus`):

```text
  +-------+  validate readiness   +------------------+
  | DRAFT | --------------------> | READY_FOR_REVIEW |
  +-------+                       +------------------+
     ^  |                           |      |       |
     |  | archive                   | edit |       | publish_exam_atomic()
     |  v                           | back |       v
     | +----------+                 |      |  +-----------+
     | | ARCHIVED | <---------------+      +->| PUBLISHED |
     | +----------+ <-----------------------  +-----------+
     |      ^            close / archive        |       |
     |      |                                   |       | start_exam_revision()
     |      |      +--------+                   |       | (explicit revision only)
     |      +----- | CLOSED | <-----------------+       |
     |             +--------+                           |
     +--------------------------------------------------+
```

| Status | Editable Draft Content? | Purpose |
|---|---|---|
| `DRAFT` | Yes | Initial configuration, bank question selection, schedule setup |
| `READY_FOR_REVIEW` | Yes (returns to `DRAFT` on edits) | Passed `validateExamReadiness()` checklist and queued for publishing |
| `PUBLISHED` | **No** (locked by `trg_guard_draft_exam_questions`) | `published_version_id` points to the active immutable `exam_versions` snapshot |
| `CLOSED` | **No** | Examination closed administratively or post-window; read-only history |
| `ARCHIVED` | **No** | Terminal read-only archive state |

---

## 2. Readiness Validation Checklist (`validateExamReadiness`)

Before entering `READY_FOR_REVIEW` or executing `publish_exam_atomic`, all criteria must pass:

1. **Non-empty active questions:** At least 1 draft question exists, and zero linked questions are archived or missing `current_version`.
2. **Valid answer keys:** Every objective question (`single_choice`, `multiple_choice`, `true_false`) has at least 1 answer key in `question_answer_keys`. (`essay` questions pass automatically with `manual_rubric`.)
3. **Valid execution schedule & classes:** At least 1 assigned class (`exam_assignments`) and valid UTC `starts_at` < `ends_at` with `(ends_at - starts_at) >= duration_minutes`.
4. **Valid passing threshold:** `totalPoints > 0` and `passing_score <= totalPoints` (prevents mathematically impossible passing thresholds).

---

## 3. Atomic Snapshot Publishing (`publish_exam_atomic`)

Publishing executes inside a single PostgreSQL transaction in `supabase/migrations/20261112000005_phase2_rls_and_publish_rpc.sql`:

1. Verifies caller authorization (`auth_is_school_admin()` or active teacher of the exam's subject) and optimistic lock (`p_expected_version_lock`).
2. Locks the parent `exams` row (`FOR UPDATE`) to prevent concurrent double-publishing races (`ALREADY_PUBLISHED` / `CONCURRENCY_CONFLICT`).
3. Re-validates draft readiness inside SQL (active questions, valid UTC window, `(ends_at - starts_at) >= duration_minutes`, at least one class assignment, `total_points >= passing_score`).
4. Inserts an immutable `exam_versions` header (`version_number = MAX + 1`, frozen settings, `snapshot_hash` SHA-256 digest, `is_frozen = true`).
5. Copies each draft item's `current_version` into `exam_version_questions` (`source_question_id`, `source_question_version_id`, `stem`, `explanation`, `points`, `scoring_policy`, `rubric_notes`, `options_snapshot jsonb` containing no correctness metadata).
6. Copies each question version's `correct_option_keys` into the separated `exam_version_answer_keys` table.
7. Updates `exams.status = 'PUBLISHED'`, `exams.published_version_id = new_version_id`, bumps `version_lock`, ensures `exam_schedules` rows match the published window/settings, and appends a `PUBLISHED` row to `exam_publication_events`.

---

## 4. Explicit Revision Workflow (`PUBLISHED -> DRAFT`)

Published exam snapshots (`exam_versions`, `exam_version_questions`, `exam_version_answer_keys`) are **never mutated in place**.

If a teacher needs to correct an error or adjust schedule/settings after publication, they trigger `POST /api/teacher/exams/[id]/revision` (`start_exam_revision` RPC):
- Transitions `exams.status` from `PUBLISHED` back to `DRAFT` and bumps `version_lock`.
- Records an append-only `REVISION_STARTED` row in `exam_publication_events` referencing the prior `exam_version_id`.
- Leaves prior `exam_versions` intact so any future student attempts or historical audit trails bound to Version 1 remain reproducible.
- Re-publishing after edits produces `version_number = 2`, leaving Version 1 immutable.

---

## 5. Deterministic Randomization & Phase 3 Handoff Contract

Prepared in `src/domain/exams/exam-lifecycle.ts` for the Phase 3 student attempt engine:
- `computeDeterministicShuffleSeed(examVersionId, studentId, attemptNumber)` produces a reproducible SHA-256-derived 32-bit unsigned seed per candidate attempt.
- `deterministicShuffleWithPins(items, seed, isPinned)` shuffles only unpinned elements while keeping pinned anchor questions (`preserve_question_position = true`) in their configured slots.
- Phase 3 will read **only** from `exam_versions` and `exam_version_questions` for candidate attempt rendering and join `exam_version_answer_keys` exclusively in server-side grading transactions.
