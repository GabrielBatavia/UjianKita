# Database Design & Migrations

UjianKita uses Supabase PostgreSQL with versioned SQL migrations located in `supabase/migrations/`.

---

## 1. Phase 1 Migrations

1. [`20261112000001_phase1_foundation_schema.sql`](../supabase/migrations/20261112000001_phase1_foundation_schema.sql)
   - Creates `schools`, `roles`, `permissions`, `role_permissions`, `user_profiles`, `user_roles`, `academic_years`, `teachers`, `classes`, `subjects`, `students`, `class_enrollments`, `teacher_assignments`, and `audit_events`.
   - Enforces referential integrity via foreign keys, `CHECK` constraints, `UNIQUE` constraints, partial unique indexes (e.g., at most one active academic year per school; at most one active enrollment per student per academic year; unique non-empty NISN/NIP per school), and `updated_at` triggers.
   - Seeds structural system `roles`, `permissions`, and `role_permissions` idempotently.

2. [`20261112000002_phase1_rls_and_functions.sql`](../supabase/migrations/20261112000002_phase1_rls_and_functions.sql)
   - Installs append-only immutability trigger (`trg_audit_events_immutable`) blocking all `UPDATE` and `DELETE` operations on `audit_events`.
   - Installs `trg_protect_user_profile_sensitive` preventing non-admin callers from mutating `school_id`, `is_active`, or `email`.
   - Defines `SECURITY DEFINER` authorization helpers (`auth_school_id`, `auth_has_role`, `auth_is_school_admin`, `auth_teacher_teaches_class`, `auth_student_in_class`, `auth_teacher_teaches_student`, `auth_can_read_profile`) with `SET search_path = public, auth` to prevent RLS recursion.
   - Enables RLS on every `public` table and applies least-privilege policies.

3. [`supabase/seed.sql`](../supabase/seed.sql) *(Non-production development only)*
   - Inserts one synthetic school (`SMAN1-SIMULASI`), one active academic year (`2026/2027`), and baseline subjects. Never run against production data.

---

## 2. Phase 1 Entity Relationship Overview

```text
schools (tenant root)
 ├── academic_years (1 active per school)
 ├── subjects (unique code per school)
 ├── user_profiles (1:1 with auth.users)
 │    ├── user_roles ──> roles ──> role_permissions ──> permissions
 │    ├── teachers (1:1 with user_profiles)
 │    └── students (1:1 with user_profiles, unique nis/nisn per school)
 ├── classes (belongs to academic_year, optional homeroom teacher)
 │    ├── class_enrollments (links student + class; 1 active per year)
 │    └── teacher_assignments (links teacher + class + subject + year)
 └── audit_events (append-only log of auth and academic actions)
```

---

## 3. Proposed Phase 2 & Phase 3 Schema (Documented Only — Not Yet Migrated)

Per Phase 1 scope, critical examination tables are **not** prematurely migrated in Phase 1. Their planned relational structure follows Blueprint Section 11:

### Content & Question Bank (Phase 2)
- `question_banks` (`id`, `school_id`, `subject_id`, `title`, `created_by`)
- `questions` (`id`, `bank_id`, `question_type`, `difficulty`, `status`, `current_version_id`)
- `question_versions` (`id`, `question_id`, `version_number`, `stem_richtext`, `media_refs`, `metadata`, `is_approved`)
- `question_options` (`id`, `question_version_id`, `option_key`, `content_richtext`, `display_order`)
- `answer_keys` (**strictly isolated from student RLS**: `id`, `question_version_id`, `key_payload`, `scoring_rubric`, `approved_by`)

### Published Examinations (Phase 2)
- `exams` (`id`, `school_id`, `subject_id`, `title`, `status`)
- `exam_versions` (`id`, `exam_id`, `version_number`, `is_frozen`, `duration_minutes`, `settings_snapshot`, `approved_by`, `approved_at`)
- `exam_questions` (`exam_version_id`, `question_version_id`, `position`, `points`)
- `exam_schedules` (`id`, `exam_version_id`, `class_id`, `starts_at_utc`, `ends_at_utc`, `late_join_cutoff_utc`, `browser_policy`)
- `exam_approvals` (`id`, `exam_version_id`, `approver_user_id`, `decision`, `reason`, `decided_at`)

### Attempts, Authoritative Saving & Receipts (Phase 2)
- `exam_attempts` (`id`, `school_id`, `exam_schedule_id`, `exam_version_id`, `student_id`, `status`, `started_at_utc`, `deadline_at_utc`, `question_order_seed`, `submitted_at_utc`, unique active constraint per student/schedule)
- `attempt_questions` (`id`, `attempt_id`, `question_version_id`, `display_index`, `option_order_map`)
- `student_answers` (`id`, `attempt_id`, `question_version_id`, `latest_revision`, `response_payload`, `committed_at_utc`, unique `(attempt_id, question_version_id)`)
- `answer_revisions` (append-only history: `id`, `attempt_id`, `question_version_id`, `revision`, `idempotency_key`, `response_payload`, `committed_at_utc`, unique `(attempt_id, idempotency_key)`)
- `submission_receipts` (`id`, `attempt_id` unique, `receipt_code` unique, `answered_count`, `integrity_digest`, `issued_at_utc`)

### Grading & Monitoring (Phase 2–3)
- `grades` (`id`, `attempt_id` unique, `objective_score`, `essay_score`, `total_score`, `status`, `released_at_utc`)
- `essay_assessments` (`id`, `attempt_id`, `question_version_id`, `grader_user_id`, `score`, `rubric_notes`, `graded_at_utc`)
- `grade_adjustments` (`id`, `grade_id`, `previous_score`, `new_score`, `reason`, `requested_by`, `approved_by`, `created_at`)
- `activity_events` (`id`, `attempt_id`, `event_type`, `occurred_at_utc`, `metadata`)
- `security_incidents` (`id`, `attempt_id`, `severity`, `reviewer_user_id`, `notes`, `resolution_status`)
