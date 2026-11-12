-- ============================================================================
-- UjianKita Phase 3 Migration 000006: Student Examination Engine, Attempt
-- Lifecycle, Idempotent Answer Persistence, Submission Receipts & Grading Schema
-- ============================================================================

-- 1. Extend exams table cleanly for result release policy & student review controls
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS result_release_policy text NOT NULL DEFAULT 'manual'
    CHECK (result_release_policy IN ('manual', 'after_submit_if_no_essay', 'after_window_close')),
  ADD COLUMN IF NOT EXISTS results_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS results_released_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allow_student_review boolean NOT NULL DEFAULT false;

-- 2. Phase 3 RBAC Permissions
INSERT INTO public.permissions (code, module, description) VALUES
  ('student.exams.read', 'student_examination', 'Melihat jadwal ujian siswa dan status kelayakan'),
  ('student.attempts.write', 'student_examination', 'Memulai, menyimpan jawaban, dan mengumpulkan sesi ujian'),
  ('student.results.read', 'student_examination', 'Melihat bukti pengumpulan dan hasil ujian yang dirilis'),
  ('exams.grade', 'grading_engine', 'Menilai jawaban esai, meninjau sesi siswa, dan melakukan koreksi nilai'),
  ('exams.results.release', 'grading_engine', 'Merilis atau menarik publikasi nilai ujian kepada siswa')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('exams.grade', 'exams.results.release')
WHERE r.code IN ('admin', 'teacher')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'student.exams.read',
  'student.attempts.write',
  'student.results.read'
)
WHERE r.code = 'student'
ON CONFLICT DO NOTHING;

-- 3. Exam Attempts (Authoritative server-side session & deadline record)
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (
    status IN (
      'NOT_STARTED',
      'IN_PROGRESS',
      'SUBMITTING',
      'SUBMITTED',
      'EXPIRED',
      'CANCELLED_BY_ADMIN'
    )
  ),
  started_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  deadline_at_utc timestamptz NOT NULL,
  submitted_at_utc timestamptz,
  last_activity_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  time_extension_minutes integer NOT NULL DEFAULT 0 CHECK (
    time_extension_minutes >= 0 AND time_extension_minutes <= 120
  ),
  client_timezone text,
  start_idempotency_key uuid,
  cancellation_reason text,
  cancelled_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  cancelled_at_utc timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_exam_attempts_exam_student_num UNIQUE (exam_id, student_id, attempt_number),
  CONSTRAINT uq_exam_attempts_start_key UNIQUE (exam_id, student_id, start_idempotency_key)
);

-- Enforce single active attempt per student & exam even under concurrent start requests
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_attempts_single_active
  ON public.exam_attempts(exam_id, student_id)
  WHERE status IN ('IN_PROGRESS', 'SUBMITTING');

CREATE INDEX IF NOT EXISTS idx_exam_attempts_school_exam_status
  ON public.exam_attempts(school_id, exam_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_exam
  ON public.exam_attempts(student_id, exam_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_active_deadline
  ON public.exam_attempts(status, deadline_at_utc)
  WHERE status IN ('IN_PROGRESS', 'SUBMITTING');

CREATE TRIGGER trg_exam_attempts_updated_at
  BEFORE UPDATE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Frozen Realized Attempt Question Assignments (deterministic shuffle & student-safe prompt only)
-- NEVER stores answer keys, explanations, or grading rubrics.
CREATE TABLE IF NOT EXISTS public.attempt_question_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  exam_version_question_id uuid NOT NULL REFERENCES public.exam_version_questions(id) ON DELETE RESTRICT,
  display_index integer NOT NULL CHECK (display_index >= 1),
  question_type text NOT NULL CHECK (
    question_type IN ('single_choice', 'multiple_choice', 'true_false', 'essay')
  ),
  stem_snapshot text NOT NULL,
  points_snapshot numeric(8,2) NOT NULL CHECK (points_snapshot > 0),
  option_order_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_attempt_qa_attempt_order UNIQUE (attempt_id, display_index),
  CONSTRAINT uq_attempt_qa_attempt_evq UNIQUE (attempt_id, exam_version_question_id)
);

CREATE INDEX IF NOT EXISTS idx_attempt_qa_attempt_order
  ON public.attempt_question_assignments(attempt_id, display_index);

-- 5. Authoritative Latest Student Answers (1 row per attempt x assigned question)
CREATE TABLE IF NOT EXISTS public.student_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  attempt_question_id uuid NOT NULL REFERENCES public.attempt_question_assignments(id) ON DELETE CASCADE,
  exam_version_question_id uuid NOT NULL REFERENCES public.exam_version_questions(id) ON DELETE RESTRICT,
  latest_revision integer NOT NULL CHECK (latest_revision >= 0),
  idempotency_key uuid NOT NULL,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_flagged_for_review boolean NOT NULL DEFAULT false,
  has_answer boolean NOT NULL DEFAULT false,
  committed_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_student_answers_attempt_question UNIQUE (attempt_id, attempt_question_id)
);

CREATE INDEX IF NOT EXISTS idx_student_answers_attempt
  ON public.student_answers(attempt_id);

CREATE TRIGGER trg_student_answers_updated_at
  BEFORE UPDATE ON public.student_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Append-Only Answer Revision History
CREATE TABLE IF NOT EXISTS public.answer_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  attempt_question_id uuid NOT NULL REFERENCES public.attempt_question_assignments(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  idempotency_key uuid NOT NULL,
  response_payload jsonb NOT NULL,
  committed_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_answer_revisions_attempt_q_rev UNIQUE (attempt_id, attempt_question_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_answer_revisions_attempt_q
  ON public.answer_revisions(attempt_id, attempt_question_id, revision DESC);

-- 7. Answer Save Idempotency Registry (prevents duplicate & conflicting retry corruption)
CREATE TABLE IF NOT EXISTS public.answer_save_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  attempt_question_id uuid NOT NULL REFERENCES public.attempt_question_assignments(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  client_revision integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('COMMITTED')),
  committed_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_answer_save_requests_attempt_key UNIQUE (attempt_id, idempotency_key)
);

-- 8. Authoritative Immutable Exam Submissions (1 finalized submission per attempt)
CREATE TABLE IF NOT EXISTS public.exam_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id) ON DELETE RESTRICT,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  submission_idempotency_key uuid NOT NULL,
  final_status text NOT NULL CHECK (final_status IN ('SUBMITTED', 'EXPIRED')),
  answered_count integer NOT NULL CHECK (answered_count >= 0),
  total_questions integer NOT NULL CHECK (total_questions >= 0),
  submitted_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  submitted_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_exam_submissions_attempt_idem UNIQUE (attempt_id, submission_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_exam_submissions_exam_student
  ON public.exam_submissions(exam_id, student_id);

-- 9. Immutable Student Submission Receipts
CREATE TABLE IF NOT EXISTS public.submission_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL UNIQUE REFERENCES public.exam_submissions(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id) ON DELETE RESTRICT,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  receipt_code text NOT NULL UNIQUE,
  answered_count integer NOT NULL CHECK (answered_count >= 0),
  total_questions integer NOT NULL CHECK (total_questions >= 0),
  integrity_digest text NOT NULL,
  issued_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_submission_receipts_student
  ON public.submission_receipts(student_id, issued_at_utc DESC);

-- 10. Authoritative Exam Grades (1 row per attempt, decoupled release visibility)
CREATE TABLE IF NOT EXISTS public.exam_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id) ON DELETE RESTRICT,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  grading_status text NOT NULL CHECK (
    grading_status IN ('PENDING_OBJECTIVE', 'PENDING_MANUAL_REVIEW', 'GRADED', 'ADJUSTED')
  ),
  release_status text NOT NULL DEFAULT 'UNRELEASED' CHECK (
    release_status IN ('UNRELEASED', 'RELEASED')
  ),
  objective_score numeric(10,2) NOT NULL DEFAULT 0 CHECK (objective_score >= 0),
  manual_score numeric(10,2) NOT NULL DEFAULT 0 CHECK (manual_score >= 0),
  adjustment_delta numeric(10,2) NOT NULL DEFAULT 0,
  total_score numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  max_score numeric(10,2) NOT NULL DEFAULT 0 CHECK (max_score >= 0),
  percentage_score numeric(6,2) NOT NULL DEFAULT 0 CHECK (percentage_score >= 0 AND percentage_score <= 100),
  passed boolean NOT NULL DEFAULT false,
  pending_manual_count integer NOT NULL DEFAULT 0 CHECK (pending_manual_count >= 0),
  graded_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  graded_at_utc timestamptz,
  released_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  released_at_utc timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_exam_grades_exam_status
  ON public.exam_grades(exam_id, grading_status, release_status);
CREATE INDEX IF NOT EXISTS idx_exam_grades_student
  ON public.exam_grades(student_id, release_status);

CREATE TRIGGER trg_exam_grades_updated_at
  BEFORE UPDATE ON public.exam_grades
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 11. Manual Essay Grading Entries (per attempt x exam_version_question)
CREATE TABLE IF NOT EXISTS public.manual_grading_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  exam_version_question_id uuid NOT NULL REFERENCES public.exam_version_questions(id) ON DELETE RESTRICT,
  assigned_score numeric(8,2) NOT NULL CHECK (assigned_score >= 0),
  max_points numeric(8,2) NOT NULL CHECK (max_points > 0),
  feedback text,
  grader_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  graded_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_manual_grading_attempt_question UNIQUE (attempt_id, exam_version_question_id),
  CONSTRAINT chk_manual_grading_bounds CHECK (assigned_score <= max_points)
);

CREATE INDEX IF NOT EXISTS idx_manual_grading_attempt
  ON public.manual_grading_entries(attempt_id);

CREATE TRIGGER trg_manual_grading_entries_updated_at
  BEFORE UPDATE ON public.manual_grading_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12. Append-Only Audited Grade Adjustments
CREATE TABLE IF NOT EXISTS public.grade_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_grade_id uuid NOT NULL REFERENCES public.exam_grades(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE RESTRICT,
  previous_total_score numeric(10,2) NOT NULL,
  new_total_score numeric(10,2) NOT NULL CHECK (new_total_score >= 0),
  adjustment_delta numeric(10,2) NOT NULL,
  reason text NOT NULL,
  adjusted_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_grade_adjustments_attempt_created
  ON public.grade_adjustments(attempt_id, created_at_utc DESC);

-- 13. Append-Only Attempt Activity & Integrity Telemetry Log (with explicit trust source)
CREATE TABLE IF NOT EXISTS public.attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  event_source text NOT NULL CHECK (
    event_source IN ('server_confirmed', 'client_reported', 'server_inferred')
  ),
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_attempt_events_attempt_created
  ON public.attempt_events(attempt_id, created_at_utc DESC);
