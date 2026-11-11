-- ============================================================================
-- UjianKita Synthetic Development Seed (NON-PRODUCTION ONLY)
-- Do NOT run against production with real school or student data.
-- Creates one synthetic school, academic year, subjects, and sample structure.
-- Auth accounts should be created via Supabase Auth or scripts/seed-dev-users.ts
-- so password hashes and auth.identities stay compatible with GoTrue.
-- ============================================================================

INSERT INTO public.schools (id, code, name, npsn, level, address, phone, email, timezone, academic_calendar_note, result_release_policy)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'SMAN1-SIMULASI',
  'SMA Negeri 1 Simulasi',
  '20100001',
  'SMA',
  'Jl. Pendidikan No. 1, Jakarta Pusat',
  '021-5550100',
  'info@sman1simulasi.sch.id',
  'Asia/Jakarta',
  'Tahun Ajaran Simulasi Pengujian Sistem CBT UjianKita',
  'manual_review'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.academic_years (id, school_id, name, semester, starts_on, ends_on, is_active)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '2026/2027',
  'Ganjil',
  '2026-07-13',
  '2026-12-18',
  true
)
ON CONFLICT (school_id, name, semester) DO NOTHING;

INSERT INTO public.subjects (school_id, code, name, curriculum_group, description)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'MAT-10', 'Matematika Wajib', 'Wajib', 'Mata pelajaran Matematika tingkat X'),
  ('11111111-1111-4111-8111-111111111111', 'BIN-10', 'Bahasa Indonesia', 'Wajib', 'Mata pelajaran Bahasa Indonesia tingkat X'),
  ('11111111-1111-4111-8111-111111111111', 'BIG-10', 'Bahasa Inggris', 'Wajib', 'Mata pelajaran Bahasa Inggris tingkat X'),
  ('11111111-1111-4111-8111-111111111111', 'FIS-10', 'Fisika', 'Peminatan', 'Mata pelajaran Fisika tingkat X')
ON CONFLICT (school_id, code) DO NOTHING;
