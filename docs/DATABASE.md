# Database Schema & Security Model

UjianKita uses Supabase PostgreSQL with Row Level Security (RLS), tenant-scoped foreign-key integrity triggers, immutable revision snapshots, and atomic PL/pgSQL RPCs.

---

## 1. Versioned Migrations (`supabase/migrations/`)

| Migration | Scope | Execution Verification Status |
|---|---|---|
| `20261112000001_phase1_foundation_schema.sql` | Phase 1 core tables (`schools`, `roles`, `permissions`, `role_permissions`, `user_profiles`, `user_roles`, `academic_years`, `teachers`, `classes`, `subjects`, `students`, `class_enrollments`, `teacher_assignments`, `audit_events`) + `set_updated_at()` | Reviewed in Phase 1; pending live PostgreSQL apply |
| `20261112000002_phase1_rls_and_functions.sql` | Phase 1 RLS helpers (`auth_school_id`, `auth_has_role`, `auth_is_school_admin`, `auth_teacher_teaches_class`, `auth_student_in_class`, `auth_teacher_teaches_student`, `auth_can_read_profile`), `prevent_audit_event_mutation()`, least-privilege policies | Reviewed in Phase 1; pending live PostgreSQL apply |
| `20261112000003_phase1_5_hardening.sql` | Same-school integrity triggers (`enforce_same_school_classes`, `enforce_same_school_enrollments`, `enforce_same_school_teacher_assignments`) + atomic `activate_academic_year(uuid)` RPC | Pending live PostgreSQL apply |
| `20261112000004_phase2_question_bank_and_exams.sql` | Phase 2 Question Bank, separated Answer Keys, Examination Builder, Schedules, Immutable Snapshots, Publication Events, and 6 Phase 2 RBAC permissions | Pending live PostgreSQL apply |
| `20261112000005_phase2_rls_and_publish_rpc.sql` | Phase 2 immutability triggers (`prevent_immutable_snapshot_mutation`, `guard_draft_exam_question_edits`), ownership helpers, RLS policies, and atomic RPCs | Pending live PostgreSQL apply |

---

## 2. Phase 1 Foundation Tables

- **Tenant & Identity:** `schools`, `roles` (`admin`, `teacher`, `student`, plus future `exam_coordinator`, `proctor`, `auditor`), `permissions`, `role_permissions`, `user_profiles`, `user_roles`.
- **Academic Structure:** `academic_years` (partial unique active year per school), `teachers`, `classes`, `subjects`, `students`, `class_enrollments`, `teacher_assignments`.
- **Audit Trail:** `audit_events` protected by `trg_audit_events_immutable` blocking `UPDATE` and `DELETE`.

---

## 3. Phase 2 Implemented Tables (`000004` & `000005`)

### Question Bank & Separated Answer Keys
- `question_banks` (`id`, `school_id`, `subject_id`, `created_by`, `title`, `description`, `is_archived`)
- `questions` (`id`, `school_id`, `question_bank_id`, `subject_id`, `created_by`, `current_version_id`, `question_type`, `difficulty`, `topic`, `tags[]`, `status`, `attachment_metadata`, `content_fingerprint`)
- `question_versions` (`id`, `school_id`, `question_id`, `version_number`, `stem`, `explanation`, `points`, `scoring_policy`, `rubric_notes`, `preserve_option_order`) — immutable (`trg_question_versions_immutable`)
- `question_options` (`id`, `school_id`, `question_version_id`, `option_key`, `option_text`, `display_order`) — display options only; immutable (`trg_question_options_immutable`)
- `question_answer_keys` (`id`, `school_id`, `question_version_id`, `correct_option_keys[]`, `scoring_metadata`) — **strictly separated; zero student RLS policies**; immutable (`trg_question_answer_keys_immutable`)
- `import_batches` (`id`, `school_id`, `question_bank_id`, `uploaded_by`, `file_name`, `file_format`, `total_rows`, `imported_count`, `rejected_count`, `report_summary`)

### Examination Builder, Scheduling & Immutable Snapshots
- `exams` (`id`, `school_id`, `subject_id`, `academic_year_id`, `created_by`, `title`, `description`, `instructions`, `status`, `duration_minutes`, `max_attempts`, `passing_score`, `randomize_questions`, `randomize_options`, `starts_at`, `ends_at`, `published_version_id`, `version_lock`)
- `exam_draft_questions` (`id`, `school_id`, `exam_id`, `question_id`, `display_order`, `points_override`, `preserve_order`) — guarded by `trg_guard_draft_exam_questions` (`DRAFT` / `READY_FOR_REVIEW` only)
- `exam_assignments` (`id`, `school_id`, `exam_id`, `class_id`, `assigned_by`)
- `exam_schedules` (`id`, `school_id`, `exam_id`, `class_id`, `starts_at`, `ends_at`, `duration_minutes`, `max_attempts`, `late_join_minutes`, `require_exam_browser`)
- `exam_versions` (`id`, `school_id`, `exam_id`, `version_number`, `title`, `description`, `instructions`, `subject_id`, `academic_year_id`, `duration_minutes`, `max_attempts`, `total_points`, `passing_score`, `randomize_questions`, `randomize_options`, `starts_at`, `ends_at`, `snapshot_hash`, `published_by`, `published_at`, `is_frozen`) — immutable (`trg_exam_versions_immutable`)
- `exam_version_questions` (`id`, `school_id`, `exam_version_id`, `source_question_id`, `source_question_version_id`, `display_order`, `question_type`, `difficulty`, `stem`, `explanation`, `points`, `scoring_policy`, `rubric_notes`, `preserve_option_order`, `preserve_question_position`, `options_snapshot`) — immutable (`trg_exam_version_questions_immutable`)
- `exam_version_answer_keys` (`id`, `school_id`, `exam_version_question_id`, `correct_option_keys[]`, `scoring_metadata`) — **strictly separated; zero student RLS access**; immutable (`trg_exam_version_answer_keys_immutable`)
- `exam_publication_events` (`id`, `school_id`, `exam_id`, `exam_version_id`, `event_type`, `actor_user_id`, `notes`, `metadata`, `created_at`) — append-only (`trg_exam_publication_events_immutable`)

---

## 4. Transactional PL/pgSQL RPCs (`000005`)

- `public.create_question_with_version(...)` — Atomically creates `questions`, version `1` in `question_versions`, options in `question_options`, answer key in `question_answer_keys`, and sets `current_version_id`.
- `public.update_question_new_version(...)` — Atomically creates `version_number + 1`, options, answer key, and repoints `questions.current_version_id`.
- `public.import_questions_atomic(...)` — Atomically imports validated spreadsheet question payloads and logs an `import_batches` summary.
- `public.publish_exam_atomic(p_exam_id, p_expected_version_lock, p_notes)` — Locks `exams`, checks readiness & optimistic lock, freezes `exam_versions` + `exam_version_questions` + `exam_version_answer_keys`, updates `published_version_id`, syncs schedules, and logs `PUBLISHED`.
- `public.start_exam_revision(p_exam_id, p_expected_version_lock, p_notes)` — Transitions `PUBLISHED -> DRAFT`, bumps `version_lock`, leaves published snapshots intact, and logs `REVISION_STARTED`.

---

## 5. Planned Phase 3 Tables (Not Yet Created)

The following tables remain deferred until Phase 3 (student examination delivery, grading, and live monitoring):
- `exam_attempts`, `attempt_questions`, `student_answers`, `answer_revisions`, `submission_receipts`
- `grades`, `essay_assessments`, `grade_adjustments`, `activity_events`, `security_incidents`

---

## 6. Migration Rollback Caveats

- Dropping Phase 2 tables (`20261112000004` / `20261112000005`) deletes authored questions, answer keys, draft exams, schedules, and immutable published exam versions; back up PostgreSQL before running any destructive down-migration in populated environments.
- Dropping `20261112000003` removes cross-school trigger guards (`enforce_same_school_*`); do not remove in multi-school deployments without replacement constraints.
