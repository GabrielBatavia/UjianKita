# Examination Management Module (Phase 2)

The Examination Management module allows authorized teachers and school administrators to build draft examinations from the Question Bank, configure execution parameters, assign classes and schedules, validate readiness, preview desktop and mobile rendering, publish immutable snapshots, and exercise school-level oversight.

---

## 1. Architecture & Route Surface

| Layer | Paths | Responsibilities |
|---|---|---|
| **Domain Logic** | `src/domain/exams/phase2-types.ts`, `src/domain/exams/exam-lifecycle.ts` | Types, transition rules, readiness checklist, schedule overlap detection, deterministic seed hashing |
| **Schemas** | `src/schemas/exams.ts` | Zod request validation for exam settings, draft question arrays, schedule windows, publish notes, transitions |
| **Repositories** | `src/repositories/exam-repository.ts` | Multi-table detail loading, paginated filtered listing, student-safe vs. teacher-review preview projections |
| **Services** | `src/services/exam-service.ts` | Permission/subject/class ownership verification, optimistic concurrency (`version_lock`), audit event emission, RPC invocation |
| **Teacher UI Routes** | `/teacher/exams`, `/teacher/exams/new`, `/teacher/exams/[id]`, `/teacher/exams/[id]/preview`, `/teacher/schedules` | Examination workspace, question picker & reordering, schedule overlap warnings, publish dialog, student simulation preview |
| **Teacher API Routes** | `/api/teacher/exams/*` | Thin REST endpoints delegating to `exam-service.ts` and returning structured JSON error codes (`400`, `403`, `404`, `409`) |
| **Admin Oversight** | `/admin/exams`, `/admin/exams/[id]`, `/admin/exams/[id]/preview`, `/api/admin/exams/*` | School-wide read visibility, immutable snapshot/event inspection, and audited Close / Archive controls |

---

## 2. Draft Examination Composition & Question Linking

- Exams reference bank questions via `exam_draft_questions` (`exam_id`, `question_id`, `display_order`, `points_override`, `preserve_order`), avoiding duplicate copies while editable (`DRAFT` or `READY_FOR_REVIEW`).
- Teachers can reorder questions up/down, pin specific questions (`preserve_order = true`) so randomization preserves anchor positions (e.g., grouped reading comprehension items), override question points per exam (`points_override > 0`), and search non-archived bank questions for the exam's subject.
- `trg_guard_draft_exam_questions` (`guard_draft_exam_question_edits()`) blocks database `INSERT`/`UPDATE`/`DELETE` mutations on `exam_draft_questions` whenever an exam is `PUBLISHED`, `CLOSED`, or `ARCHIVED`.

---

## 3. Class Assignments & Schedule Conflict Detection

- **Server-Verified Class Ownership:** Teachers may assign or schedule exams **only** for active classes within their school where they have an active row in `teacher_assignments` or serve as `homeroom_teacher_id` (`getAuthorizedClassesForActor`).
- **Window vs. Duration Guard:** Scheduling (`PUT /api/teacher/exams/[id]/schedule`) rejects invalid windows (`ends_at <= starts_at`) and rejects windows shorter than the exam duration (`(ends_at - starts_at) < duration_minutes * 60_000`).
- **Per-Class Schedule Entries (`exam_schedules`):** Stores UTC timestamps (`starts_at`, `ends_at`), `duration_minutes`, `max_attempts`, `late_join_minutes` (0–120), and `require_exam_browser` flag prepared for Phase 3 ExamBro / SEB iOS enforcement.
- **Overlap Detection (`detectScheduleConflicts`):** Checks assigned classes against all other non-archived exams in the same school and surfaces class-level overlap warnings in both detail responses and the schedule workspace UI (`/teacher/schedules`, `/teacher/exams/[id]`).

---

## 4. Optimistic Concurrency Control (`version_lock`)

To prevent silent overwrites when multiple browser tabs or staff members inspect an exam simultaneously:

- Every `exams` row carries a monotonically incremented `version_lock integer` (starting at `1`).
- Mutations (`PATCH /api/teacher/exams/[id]`, `PUT .../questions`, `PUT .../schedule`, `POST .../validate`, `POST .../publish`, `POST .../revision`, `POST .../status`) require `versionLock` in the request payload and conditionally update `.eq("version_lock", input.versionLock)` (or pass `p_expected_version_lock` into PostgreSQL RPCs).
- Stale updates return HTTP `409 CONCURRENCY_CONFLICT` cleanly without partial writes.

---

## 5. Student-Safe vs. Teacher-Review Previews

- **`GET /api/teacher/exams/[id]/preview?mode=student`** executes `buildStudentSafeExamPreview()` (`src/repositories/exam-repository.ts`), which:
  - Queries published snapshots ONLY from `exam_versions` and `exam_version_questions` — **never** querying `exam_version_answer_keys` or `question_answer_keys`.
  - Projects `StudentExamPreviewPayload`, omitting `correct_option_keys`, `explanation`, `scoring_policy`, and `rubric_notes`.
  - Verified by automated service-boundary integration tests.
- **`mode=teacher`** executes `buildTeacherReviewExamPreview()`, rendering answer keys, points, scoring policies, explanations, and rubrics exclusively for authorized teachers/admins.
- `ExamPreviewClient` (`/teacher/exams/[id]/preview` and `/admin/exams/[id]/preview`) includes an interactive viewport switcher (**Ponsel 390px** vs. **Desktop**) and question navigator drawer so staff inspect mobile readability before opening an exam.

---

## 6. Administrator Oversight

School administrators (`admin`) access `/admin/exams` and `/admin/exams/[id]` under permission `exams.oversight`:
- View all school examinations across subjects and academic years.
- Inspect immutable `exam_versions` history, snapshot SHA-256 hashes, and `exam_publication_events`.
- Perform audited emergency interventions (`ADMIN_CLOSED` or `ADMIN_ARCHIVED` with explanatory notes stored in both `exam_publication_events` and `audit_events`).
