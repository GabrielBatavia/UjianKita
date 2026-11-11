-- ============================================================================
-- UjianKita Phase 1 Migration 000001: Core Foundation Schema
-- Entities: schools, roles, permissions, role_permissions, user_profiles,
-- user_roles, academic_years, teachers, classes, subjects, students,
-- class_enrollments, teacher_assignments, audit_events
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- 1. Schools (tenant boundary)
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  npsn text UNIQUE,
  level text NOT NULL DEFAULT 'SMA' CHECK (level IN ('SD', 'SMP', 'SMA', 'SMK', 'OTHER')),
  address text,
  phone text,
  email text,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  academic_calendar_note text,
  result_release_policy text NOT NULL DEFAULT 'manual_review' CHECK (
    result_release_policy IN ('manual_review', 'scheduled_release', 'immediate_after_close')
  ),
  exam_policy jsonb NOT NULL DEFAULT jsonb_build_object(
    'require_exam_browser_in_high_stakes', true,
    'allow_late_join_minutes', 15,
    'heartbeat_interval_seconds', 20
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER trg_schools_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Roles & Permissions (extensible for Phase 2 roles: exam_coordinator, proctor, auditor)
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (
    code IN ('admin', 'teacher', 'student', 'exam_coordinator', 'proctor', 'auditor')
  ),
  name text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (role_id, permission_id)
);

-- 3. User Profiles (1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_user_profiles_email UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_school_id ON public.user_profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON public.user_profiles(school_id, is_active);

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. User Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_user_roles_user_role_school UNIQUE (user_id, role_id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_school_role ON public.user_roles(school_id, role_id);

-- 5. Academic Years
CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL,
  semester text NOT NULL CHECK (semester IN ('Ganjil', 'Genap', 'Tahunan')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_academic_years_dates CHECK (ends_on > starts_on),
  CONSTRAINT uq_academic_years_school_name_sem UNIQUE (school_id, name, semester)
);

CREATE INDEX IF NOT EXISTS idx_academic_years_school_id ON public.academic_years(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_one_active_per_school
  ON public.academic_years(school_id) WHERE is_active = true;

CREATE TRIGGER trg_academic_years_updated_at
  BEFORE UPDATE ON public.academic_years
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Teachers
CREATE TABLE IF NOT EXISTS public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  nip text,
  specialization text,
  employment_status text NOT NULL DEFAULT 'GTY' CHECK (
    employment_status IN ('ASN', 'PPPK', 'GTY', 'GTT', 'HONORER', 'LAINNYA')
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_teachers_school_id ON public.teachers(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_school_nip_unique
  ON public.teachers(school_id, nip) WHERE nip IS NOT NULL AND nip <> '';

CREATE TRIGGER trg_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Classes
CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  name text NOT NULL,
  grade_level text NOT NULL,
  program text,
  homeroom_teacher_id uuid REFERENCES public.teachers(id) ON DELETE SET NULL,
  capacity integer CHECK (capacity IS NULL OR (capacity > 0 AND capacity <= 100)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_classes_school_year_name UNIQUE (school_id, academic_year_id, name)
);

CREATE INDEX IF NOT EXISTS idx_classes_school_year ON public.classes(school_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_classes_homeroom ON public.classes(homeroom_teacher_id);

CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Subjects
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  curriculum_group text NOT NULL DEFAULT 'Wajib',
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_subjects_school_code UNIQUE (school_id, code)
);

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON public.subjects(school_id);

CREATE TRIGGER trg_subjects_updated_at
  BEFORE UPDATE ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. Students
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  nis text NOT NULL,
  nisn text,
  gender text CHECK (gender IN ('L', 'P')),
  guardian_name text,
  guardian_phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_students_school_nis UNIQUE (school_id, nis)
);

CREATE INDEX IF NOT EXISTS idx_students_school_id ON public.students(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_school_nisn_unique
  ON public.students(school_id, nisn) WHERE nisn IS NOT NULL AND nisn <> '';

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. Class Enrollments
CREATE TABLE IF NOT EXISTS public.class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'transferred', 'graduated', 'inactive')
  ),
  enrolled_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_class_enrollments_class_student UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_enrollments_class ON public.class_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_class_enrollments_student ON public.class_enrollments(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_class_enrollments_active_student_year
  ON public.class_enrollments(student_id, academic_year_id) WHERE status = 'active';

CREATE TRIGGER trg_class_enrollments_updated_at
  BEFORE UPDATE ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 11. Teacher Assignments
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_teacher_assignments_unique UNIQUE (teacher_id, class_id, subject_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON public.teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class ON public.teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject ON public.teacher_assignments(subject_id);

CREATE TRIGGER trg_teacher_assignments_updated_at
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 12. Audit Events (append-only security & administrative log)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL DEFAULT 'system',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_audit_events_school_created
  ON public.audit_events(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON public.audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON public.audit_events(action, created_at DESC);

-- Seed system roles & baseline permissions (structural metadata, safe for all environments)
INSERT INTO public.roles (code, name, description, is_system) VALUES
  ('admin', 'Administrator Sekolah', 'Mengelola konfigurasi sekolah, akun guru dan siswa, kelas, mata pelajaran, dan audit.', true),
  ('teacher', 'Guru', 'Mengakses kelas dan mata pelajaran yang diampu serta modul ujian pada fase berikutnya.', true),
  ('student', 'Siswa', 'Mengakses profil pribadi, jadwal ujian yang berhak diikuti, dan riwayat ujian.', true),
  ('exam_coordinator', 'Koordinator Ujian', 'Peran terencana untuk persetujuan versi ujian dan supervisi pelaksanaan.', true),
  ('proctor', 'Pengawas Ujian', 'Peran terencana untuk pemantauan sesi ujian dan pencatatan insiden.', true),
  ('auditor', 'Auditor / Dukungan', 'Peran terencana untuk membaca log audit dan diagnostik terbatas.', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, module, description) VALUES
  ('school.settings.read', 'school_administration', 'Membaca pengaturan dasar dan kebijakan ujian sekolah'),
  ('school.settings.write', 'school_administration', 'Mengubah pengaturan dasar dan kebijakan ujian sekolah'),
  ('students.read', 'student_management', 'Melihat daftar dan detail siswa'),
  ('students.write', 'student_management', 'Menambah, memperbarui, dan menonaktifkan siswa'),
  ('teachers.read', 'teacher_management', 'Melihat daftar dan detail guru'),
  ('teachers.write', 'teacher_management', 'Menambah, memperbarui, menugaskan, dan menonaktifkan guru'),
  ('classes.read', 'academic_classes', 'Melihat tahun ajaran, kelas, dan pendaftaran siswa'),
  ('classes.write', 'academic_classes', 'Mengelola tahun ajaran, kelas, dan pendaftaran siswa'),
  ('subjects.read', 'academic_subjects', 'Melihat daftar mata pelajaran'),
  ('subjects.write', 'academic_subjects', 'Mengelola daftar mata pelajaran'),
  ('audit.read', 'security_auditing', 'Melihat catatan log audit sekolah'),
  ('teacher.workspace.access', 'teacher_management', 'Mengakses ruang kerja guru'),
  ('student.portal.access', 'student_management', 'Mengakses dasbor dan profil siswa')
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
  'classes.read', 'subjects.read', 'students.read', 'teacher.workspace.access'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('student.portal.access')
WHERE r.code = 'student'
ON CONFLICT DO NOTHING;
