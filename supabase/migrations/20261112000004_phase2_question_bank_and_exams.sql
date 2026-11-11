-- ============================================================================
-- UjianKita Phase 2 Migration 000004: Question Bank, Versioned Questions,
-- Separated Answer Keys, Examination Builder, Scheduling, and Immutable
-- Published Exam Snapshots
--
-- Rollback caveat: Dropping Phase 2 tables removes question bank and draft/
-- published examination records. Back up PostgreSQL before running a down
-- migration in any environment with authored content.
-- ============================================================================

-- 1. Question Banks (per-school, per-subject containers)
CREATE TABLE IF NOT EXISTS public.question_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_question_banks_school_subject_title UNIQUE (school_id, subject_id, title)
);

CREATE INDEX IF NOT EXISTS idx_question_banks_school_subject
  ON public.question_banks(school_id, subject_id);

CREATE TRIGGER trg_question_banks_updated_at
  BEFORE UPDATE ON public.question_banks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Questions (logical identity across revisions)
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_bank_id uuid NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  current_version_id uuid,
  question_type text NOT NULL CHECK (
    question_type IN ('single_choice', 'multiple_choice', 'true_false', 'essay')
  ),
  difficulty text NOT NULL DEFAULT 'medium' CHECK (
    difficulty IN ('easy', 'medium', 'hard')
  ),
  topic text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'active', 'archived')
  ),
  attachment_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_questions_school_subject_status
  ON public.questions(school_id, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_questions_bank_created
  ON public.questions(question_bank_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_fingerprint
  ON public.questions(school_id, subject_id, content_fingerprint);
CREATE INDEX IF NOT EXISTS idx_questions_tags_gin
  ON public.questions USING gin(tags);

CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Question Versions (immutable revision snapshots)
CREATE TABLE IF NOT EXISTS public.question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  stem text NOT NULL CHECK (char_length(trim(stem)) >= 1),
  explanation text,
  points numeric(8,2) NOT NULL CHECK (points > 0 AND points <= 1000),
  scoring_policy text NOT NULL CHECK (
    scoring_policy IN ('exact_match', 'partial_credit_disabled', 'manual_rubric')
  ),
  rubric_notes text,
  preserve_option_order boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_question_versions_question_num UNIQUE (question_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_question_versions_question
  ON public.question_versions(question_id, version_number DESC);

ALTER TABLE public.questions
  ADD CONSTRAINT fk_questions_current_version
  FOREIGN KEY (current_version_id) REFERENCES public.question_versions(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- 4. Question Options (NO answer-key flag stored in this table)
CREATE TABLE IF NOT EXISTS public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_version_id uuid NOT NULL REFERENCES public.question_versions(id) ON DELETE CASCADE,
  option_key text NOT NULL CHECK (char_length(trim(option_key)) >= 1),
  option_text text NOT NULL CHECK (char_length(trim(option_text)) >= 1),
  display_order integer NOT NULL CHECK (display_order >= 0),
  CONSTRAINT uq_question_options_version_key UNIQUE (question_version_id, option_key),
  CONSTRAINT uq_question_options_version_order UNIQUE (question_version_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_question_options_version
  ON public.question_options(question_version_id, display_order);

-- 5. Question Answer Keys (strictly separated table with zero student RLS access)
CREATE TABLE IF NOT EXISTS public.question_answer_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_version_id uuid NOT NULL UNIQUE REFERENCES public.question_versions(id) ON DELETE CASCADE,
  correct_option_keys text[] NOT NULL DEFAULT '{}'::text[],
  scoring_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 6. Import Batches (audit and reporting log for bulk CSV/XLSX imports)
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  question_bank_id uuid NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_format text NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  imported_count integer NOT NULL CHECK (imported_count >= 0),
  rejected_count integer NOT NULL CHECK (rejected_count >= 0),
  report_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_import_batches_school_created
  ON public.import_batches(school_id, created_at DESC);

-- 7. Exams (mutable configuration & lifecycle container)
CREATE TABLE IF NOT EXISTS public.exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(trim(title)) >= 3),
  description text,
  instructions text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED', 'CLOSED', 'ARCHIVED')
  ),
  duration_minutes integer NOT NULL CHECK (duration_minutes >= 1 AND duration_minutes <= 480),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  passing_score numeric(8,2) NOT NULL DEFAULT 70 CHECK (passing_score >= 0),
  randomize_questions boolean NOT NULL DEFAULT false,
  randomize_options boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  published_version_id uuid,
  version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_exams_window CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_exams_school_status
  ON public.exams(school_id, status);
CREATE INDEX IF NOT EXISTS idx_exams_school_subject_year
  ON public.exams(school_id, subject_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_exams_created_by
  ON public.exams(created_by);

CREATE TRIGGER trg_exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Draft Exam Questions (references bank questions without duplicating records)
CREATE TABLE IF NOT EXISTS public.exam_draft_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
  display_order integer NOT NULL CHECK (display_order >= 1),
  points_override numeric(8,2) CHECK (points_override IS NULL OR points_override > 0),
  preserve_order boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_exam_draft_questions_exam_question UNIQUE (exam_id, question_id),
  CONSTRAINT uq_exam_draft_questions_exam_order UNIQUE (exam_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_exam_draft_questions_exam
  ON public.exam_draft_questions(exam_id, display_order);

-- 9. Exam Class Assignments & Schedules
CREATE TABLE IF NOT EXISTS public.exam_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_exam_assignments_exam_class UNIQUE (exam_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_assignments_class
  ON public.exam_assignments(class_id);

CREATE TABLE IF NOT EXISTS public.exam_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes >= 1 AND duration_minutes <= 480),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts >= 1 AND max_attempts <= 10),
  late_join_minutes integer NOT NULL DEFAULT 15 CHECK (late_join_minutes >= 0 AND late_join_minutes <= 120),
  require_exam_browser boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_exam_schedules_window CHECK (ends_at > starts_at),
  CONSTRAINT uq_exam_schedules_exam_class UNIQUE (exam_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_school_window
  ON public.exam_schedules(school_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_class_window
  ON public.exam_schedules(class_id, starts_at, ends_at);

CREATE TRIGGER trg_exam_schedules_updated_at
  BEFORE UPDATE ON public.exam_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. Immutable Published Exam Versions (frozen snapshot consumed by Phase 3)
CREATE TABLE IF NOT EXISTS public.exam_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  title text NOT NULL,
  description text,
  instructions text,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  duration_minutes integer NOT NULL,
  max_attempts integer NOT NULL,
  total_points numeric(10,2) NOT NULL CHECK (total_points > 0),
  passing_score numeric(8,2) NOT NULL,
  randomize_questions boolean NOT NULL,
  randomize_options boolean NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  snapshot_hash text NOT NULL,
  published_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  is_frozen boolean NOT NULL DEFAULT true CHECK (is_frozen = true),
  CONSTRAINT uq_exam_versions_exam_num UNIQUE (exam_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_exam_versions_exam
  ON public.exam_versions(exam_id, version_number DESC);

ALTER TABLE public.exams
  ADD CONSTRAINT fk_exams_published_version
  FOREIGN KEY (published_version_id) REFERENCES public.exam_versions(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 11. Immutable Snapshot Questions (NO answer keys inside options_snapshot)
CREATE TABLE IF NOT EXISTS public.exam_version_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_version_id uuid NOT NULL REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
  source_question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
  source_question_version_id uuid NOT NULL REFERENCES public.question_versions(id) ON DELETE RESTRICT,
  display_order integer NOT NULL CHECK (display_order >= 1),
  question_type text NOT NULL CHECK (
    question_type IN ('single_choice', 'multiple_choice', 'true_false', 'essay')
  ),
  difficulty text NOT NULL,
  stem text NOT NULL,
  explanation text,
  points numeric(8,2) NOT NULL CHECK (points > 0),
  scoring_policy text NOT NULL,
  rubric_notes text,
  preserve_option_order boolean NOT NULL DEFAULT false,
  preserve_question_position boolean NOT NULL DEFAULT false,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_exam_version_questions_order UNIQUE (exam_version_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_exam_version_questions_version
  ON public.exam_version_questions(exam_version_id, display_order);

-- 12. Immutable Published Answer Keys (strictly isolated from student access)
CREATE TABLE IF NOT EXISTS public.exam_version_answer_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_version_question_id uuid NOT NULL UNIQUE REFERENCES public.exam_version_questions(id) ON DELETE RESTRICT,
  correct_option_keys text[] NOT NULL DEFAULT '{}'::text[],
  scoring_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 13. Append-Only Exam Publication & Lifecycle Events
CREATE TABLE IF NOT EXISTS public.exam_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  exam_version_id uuid REFERENCES public.exam_versions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'VALIDATED',
      'PUBLISHED',
      'CLOSED',
      'ARCHIVED',
      'REVISION_STARTED',
      'ADMIN_CLOSED',
      'ADMIN_ARCHIVED'
    )
  ),
  actor_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_exam_pub_events_exam_created
  ON public.exam_publication_events(exam_id, created_at DESC);

-- 14. Phase 2 RBAC Permissions
INSERT INTO public.permissions (code, module, description) VALUES
  ('questions.read', 'question_bank', 'Membaca dan mencari bank soal serta pratinjau soal'),
  ('questions.write', 'question_bank', 'Membuat, memperbarui versi, mengimpor, dan mengarsipkan soal'),
  ('exams.read', 'examination_management', 'Membaca daftar ujian, konfigurasi, jadwal, dan riwayat publikasi'),
  ('exams.write', 'examination_management', 'Membuat draf ujian, memilih soal, dan mengatur jadwal'),
  ('exams.publish', 'examination_management', 'Menerbitkan versi ujian imutabel dan menutup ujian'),
  ('exams.oversight', 'school_administration', 'Pengawasan ujian lintas kelas/mapel pada tingkat sekolah')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'questions.read',
  'questions.write',
  'exams.read',
  'exams.write',
  'exams.publish'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;
