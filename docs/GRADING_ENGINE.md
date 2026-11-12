# Authoritative Grading Engine, Manual Essay Review & Result Release

UjianKita executes all score calculations strictly on the server inside PostgreSQL (`_compute_and_upsert_exam_grade` in migration `000007`) and reproduces matching deterministic logic in pure TypeScript domain helpers (`src/domain/exams/grading.ts`) for unit testing and audit transparency.

---

## 1. Objective Auto-Scoring Rules (`src/domain/exams/grading.ts`)

All calculations operate on **canonical option keys** mapped from each student's randomized display keys via `attempt_question_assignments.option_order_map`, using scaled integer arithmetic (`SCALE = 100`) to prevent binary floating-point rounding drift across fractional weights:

| Question Type | Scoring Policy | Rule |
|---|---|---|
| `single_choice` | Exact match | Full `points_snapshot` if student canonical option key equals the canonical answer key; otherwise `0`. |
| `true_false` | Exact match | Full `points_snapshot` if selected canonical boolean option equals answer key; otherwise `0`. |
| `multiple_choice` | `exact_match` (default) | Order-independent set equality (`[...keys].sort()` matches canonical key set exactly); otherwise `0`. |
| `essay` | `manual_rubric` | **Never auto-scored as zero.** Awarded points = `0` tentatively while incrementing `pending_manual_count`; sets `grading_status = 'PENDING_MANUAL_REVIEW'`. |

---

## 2. Manual Essay Grading & Recalculation

Teachers assigned to the exam's subject (verified in `auth_teacher_can_grade_attempt` in PostgreSQL and `assertStaffExamGradeAccess` in `src/services/grading-service.ts`) open `/teacher/grading` -> `/teacher/exams/[id]/grading` (`TeacherGradingWorkspace`):

1. **Question-by-Question Review:** Displays frozen stem, student response text, manual rubric notes (`rubric_notes`), canonical/explanation context for teacher review, and maximum question points (`max_points`).
2. **Atomic Essay Save (`PUT /api/teacher/attempts/[attemptId]/grade` -> `grade_essay_and_recalculate_atomic`):**
   - Validates `0 <= assignedScore <= maxPoints` (`chk_manual_grading_bounds`).
   - Upserts `manual_grading_entries`.
   - Recomputes `objective_score + manual_score + adjustment_delta`, updates `percentage_score` (`round(total / max * 100, 2)`), `passed` (`total_score >= passing_score`), and transitions `grading_status` from `PENDING_MANUAL_REVIEW` to `GRADED` once `pending_manual_count = 0`.
   - Optional `releaseIfComplete: true` releases the student's result immediately once zero pending essay questions remain.

---

## 3. Audited Grade Adjustments

Post-grading manual score corrections execute through `POST /api/teacher/attempts/[attemptId]/adjust` (`adjust_exam_grade_atomic`):
- **Precondition:** Rejects adjustments while essays remain ungraded (`CANNOT_ADJUST_WHILE_ESSAY_PENDING`).
- **Mandatory Audit Reason:** Requires a non-empty reason (minimum 5 characters in Zod & PostgreSQL `ADJUSTMENT_REASON_REQUIRED`).
- **Append-Only Ledger:** Inserts an immutable row into `grade_adjustments` recording `previous_total_score`, `new_total_score`, `adjustment_delta`, `reason`, and `adjusted_by` (protected against `UPDATE`/`DELETE` by `trg_grade_adjustments_immutable`), transitions `exam_grades.grading_status` to `ADJUSTED`, and logs `grading.adjusted` in `audit_events`.

---

## 4. Decoupled Result Release Policies

Results remain hidden (`UNRELEASED`) from students by default until authorized by the exam's `result_release_policy`:

| Policy | Behavior |
|---|---|
| `manual` | Teacher/Admin explicitly releases graded attempts via `POST /api/teacher/exams/[id]/release` (`action: "release"` or `"unpublish"`). |
| `after_submit_if_no_essay` | Automatically releases upon attempt finalization **only** if `pending_manual_count = 0`; exams containing essays stay unreleased until manual grading completes. |
| `after_window_close` | Keeps results hidden while exam schedule window remains open; teacher releases once window closes. |

Students read `/student/results` via RLS-protected policies checking `release_status = 'RELEASED'` — unreleased grades remain inaccessible both at the PostgreSQL layer and API layer (`canStudentViewExamResults()`).
