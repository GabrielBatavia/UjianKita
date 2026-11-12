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
| `20261112000006_phase3_attempt_and_grading_schema.sql` | Phase 3 exam result-release columns on `exams`, 5 Phase 3 RBAC permissions, `exam_attempts` (`idx_exam_attempts_single_active`), `attempt_question_assignments`, `student_answers`, `answer_revisions`, `answer_save_requests`, `exam_submissions`, `submission_receipts`, `exam_grades`, `manual_grading_entries`, `grade_adjustments`, and `attempt_events` | Pending live PostgreSQL apply |
| `20261112000007_phase3_rls_and_attempt_rpcs.sql` | Phase 3 immutability triggers, student read isolation RLS policies (`exams_student_select`, `auth_student_can_access_exam`, `auth_teacher_can_grade_attempt`, released `exam_grades`), and atomic attempt/save/submit/grading/release/cancel RPCs | Pending live PostgreSQL apply |

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

## 5. Phase 3 Implemented Tables & RPCs (`000006` & `000007`)

### Student Attempt, Persistence & Receipt Tables
- `exams` extensions: `result_release_policy` (`manual | after_submit_if_no_essay | after_window_close`), `results_released_at`, `results_released_by`, `allow_student_review`.
- `exam_attempts` (`id`, `school_id`, `exam_id`, `exam_version_id`, `student_id`, `class_id`, `attempt_number`, `status`, `started_at_utc`, `deadline_at_utc`, `submitted_at_utc`, `last_activity_at_utc`, `time_extension_minutes`, `client_timezone`, `start_idempotency_key`, `cancellation_reason`, `cancelled_by`, `cancelled_at_utc`) — partial unique index `idx_exam_attempts_single_active` permits at most one active `IN_PROGRESS`/`SUBMITTING` attempt per `(exam_id, student_id)`; finalized mutations blocked by `trg_guard_finalized_exam_attempts`.
- `attempt_question_assignments` (`id`, `school_id`, `attempt_id`, `exam_version_question_id`, `display_index`, `question_type`, `stem_snapshot`, `points_snapshot`, `option_order_map`, `options_snapshot`) — stores deterministic prompt snapshots and server display->canonical option mapping; omits keys, explanations, and rubrics.
- `student_answers` (`id`, `school_id`, `attempt_id`, `attempt_question_id`, `exam_version_question_id`, `latest_revision`, `idempotency_key`, `response_payload`, `is_flagged_for_review`, `has_answer`, `committed_at_utc`) — protected after finalization by `trg_guard_finalized_student_answers`.
- `answer_revisions` (`attempt_id`, `attempt_question_id`, `revision`, `idempotency_key`, `response_payload`, `committed_at_utc`) — append-only (`trg_answer_revisions_immutable`).
- `answer_save_requests` (`attempt_id`, `attempt_question_id`, `idempotency_key`, `request_hash`, `client_revision`, `outcome`) — unique `(attempt_id, idempotency_key)` registry preventing duplicate retry writes or payload mismatches.
- `exam_submissions` and `submission_receipts` (`receipt_code`, `integrity_digest`, `answered_count`, `total_questions`, `issued_at_utc`) — immutable (`trg_exam_submissions_immutable`, `trg_submission_receipts_immutable`).

### Grading, Audited Adjustments & Telemetry
- `exam_grades` (`attempt_id`, `exam_id`, `student_id`, `grading_status`, `release_status`, `objective_score`, `manual_score`, `adjustment_delta`, `total_score`, `max_score`, `percentage_score`, `passed`, `pending_manual_count`, `graded_by`, `graded_at_utc`, `released_by`, `released_at_utc`).
- `manual_grading_entries` (`attempt_id`, `exam_version_question_id`, `assigned_score`, `max_points`, `feedback`, `grader_user_id`, `chk_manual_grading_bounds`).
- `grade_adjustments` (`exam_grade_id`, `attempt_id`, `previous_total_score`, `new_total_score`, `adjustment_delta`, `reason`, `adjusted_by`, `created_at_utc`) — append-only (`trg_grade_adjustments_immutable`).
- `attempt_events` (`attempt_id`, `actor_user_id`, `event_source`, `event_type`, `metadata`, `created_at_utc`) — append-only (`trg_attempt_events_immutable`).

### Transactional PL/pgSQL RPCs (`000007`)
- `public.start_or_resume_exam_attempt(p_exam_id, p_start_idempotency_key, p_client_timezone)`
- `public.save_attempt_answer_atomic(p_attempt_id, p_attempt_question_id, p_idempotency_key, p_client_revision, p_response_payload, p_payload_hash, p_is_flagged)`
- `public.toggle_attempt_question_flag(p_attempt_id, p_attempt_question_id, p_is_flagged)`
- `public.submit_exam_attempt_atomic(p_attempt_id, p_idempotency_key)` (delegating to internal `_finalize_attempt_internal` & `_compute_and_upsert_exam_grade`)
- `public.finalize_expired_attempt_on_access(p_attempt_id)` & service-role batch `public.finalize_expired_exam_attempts(p_exam_id)`
- `public.grade_essay_and_recalculate_atomic(p_attempt_id, p_entries, p_release_if_complete)`
- `public.adjust_exam_grade_atomic(p_attempt_id, p_new_total_score, p_reason)`
- `public.release_exam_results_atomic(p_exam_id, p_action, p_allow_student_review)`
- `public.cancel_exam_attempt_by_admin(p_attempt_id, p_reason)`
- `public.get_student_published_question_counts(p_exam_version_ids)`

*(Dedicated Phase 4 proctoring/security-incident tables such as `security_incidents` remain deferred until ExamBro/SEB device verification.)*

---

## 6. Migration Rollback Caveats

- Dropping Phase 3 tables (`20261112000006` / `20261112000007`) permanently deletes student attempts, answers, receipts, grades, and audit telemetry.
- Dropping Phase 2 tables (`20261112000004` / `20261112000005`) deletes authored questions, answer keys, draft exams, schedules, and immutable published exam versions; back up PostgreSQL before running any destructive down-migration in populated environments.
- Dropping `20261112000003` removes cross-school trigger guards (`enforce_same_school_*`); do not remove in multi-school deployments without replacement constraints.
