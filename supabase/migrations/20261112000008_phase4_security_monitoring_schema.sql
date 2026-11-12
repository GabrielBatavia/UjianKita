-- ============================================================================
-- UjianKita Phase 4 Migration 000008: Examination Security Policies, Browser
-- Verification Metadata, Presence Tracking, Incident Review & Audit Schema
-- ============================================================================

-- 1. Seed Phase 4 Monitoring & Security Permissions
INSERT INTO public.permissions (code, module, description) VALUES
  ('monitoring.read', 'exam_monitoring', 'Melihat pusat kontrol pemantauan ujian dan linimasa kehadiran siswa'),
  ('monitoring.incidents.write', 'exam_monitoring', 'Meninjau, mencatat, dan menyelesaikan insiden keamanan ujian'),
  ('monitoring.policies.write', 'exam_monitoring', 'Mengatur kebijakan keamanan peramban dan parameter pemantauan ujian'),
  ('monitoring.oversight', 'exam_monitoring', 'Mengawasi pemantauan ujian lintas sekolah dan retensi data'),
  ('monitoring.reports.export', 'exam_monitoring', 'Mengekspor laporan keamanan dan rekap insiden ujian')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'monitoring.read',
  'monitoring.incidents.write',
  'monitoring.policies.write',
  'monitoring.oversight',
  'monitoring.reports.export'
)
WHERE r.code IN ('admin', 'exam_coordinator')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'monitoring.read',
  'monitoring.incidents.write',
  'monitoring.policies.write',
  'monitoring.reports.export'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('monitoring.read', 'monitoring.incidents.write')
WHERE r.code = 'proctor'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('monitoring.read', 'monitoring.oversight', 'monitoring.reports.export')
WHERE r.code = 'auditor'
ON CONFLICT DO NOTHING;

-- 2. Mutable Pre-Publish Exam Security Policy Configuration
CREATE TABLE IF NOT EXISTS public.exam_security_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL UNIQUE REFERENCES public.exams(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  browser_policy text NOT NULL DEFAULT 'STANDARD_BROWSER_ALLOWED' CHECK (
    browser_policy IN (
      'STANDARD_BROWSER_ALLOWED',
      'SECURE_BROWSER_RECOMMENDED',
      'VERIFIED_SEB_REQUIRED'
    )
  ),
  exambro_enabled boolean NOT NULL DEFAULT false,
  exambro_min_app_hint text,
  seb_enabled boolean NOT NULL DEFAULT false,
  seb_config_key_hash text CHECK (
    seb_config_key_hash IS NULL OR seb_config_key_hash ~* '^[a-f0-9]{64}$'
  ),
  seb_browser_exam_key_hash text CHECK (
    seb_browser_exam_key_hash IS NULL OR seb_browser_exam_key_hash ~* '^[a-f0-9]{64}$'
  ),
  seb_allow_standard_with_override boolean NOT NULL DEFAULT true,
  copy_paste_guard_enabled boolean NOT NULL DEFAULT true,
  context_menu_guard_enabled boolean NOT NULL DEFAULT true,
  watermark_enabled boolean NOT NULL DEFAULT true,
  watermark_opacity numeric(4,3) NOT NULL DEFAULT 0.080 CHECK (
    watermark_opacity >= 0.030 AND watermark_opacity <= 0.180
  ),
  heartbeat_interval_seconds integer NOT NULL DEFAULT 30 CHECK (
    heartbeat_interval_seconds >= 15 AND heartbeat_interval_seconds <= 120
  ),
  stale_threshold_seconds integer NOT NULL DEFAULT 90 CHECK (
    stale_threshold_seconds >= 45 AND stale_threshold_seconds <= 300
  ),
  visibility_switch_warn_threshold integer NOT NULL DEFAULT 3 CHECK (visibility_switch_warn_threshold >= 1),
  visibility_switch_review_threshold integer NOT NULL DEFAULT 6 CHECK (visibility_switch_review_threshold >= 2),
  hidden_duration_review_seconds integer NOT NULL DEFAULT 60 CHECK (hidden_duration_review_seconds >= 15),
  reload_warn_threshold integer NOT NULL DEFAULT 3 CHECK (reload_warn_threshold >= 1),
  reload_review_threshold integer NOT NULL DEFAULT 5 CHECK (reload_review_threshold >= 2),
  copy_paste_review_threshold integer NOT NULL DEFAULT 3 CHECK (copy_paste_review_threshold >= 1),
  privacy_notice_text text NOT NULL DEFAULT 'Selama ujian berlangsung, UjianKita mencatat sinyal teknis konektivitas (heartbeat), perubahan fokus atau muat ulang tab, serta informasi mode peramban demi keandalan layanan dan integritas evaluasi.',
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_security_policy_thresholds CHECK (
    stale_threshold_seconds >= heartbeat_interval_seconds * 2
    AND visibility_switch_review_threshold >= visibility_switch_warn_threshold
    AND reload_review_threshold >= reload_warn_threshold
  )
);

CREATE INDEX IF NOT EXISTS idx_exam_security_policies_school_exam
  ON public.exam_security_policies(school_id, exam_id);

CREATE TRIGGER trg_exam_security_policies_updated_at
  BEFORE UPDATE ON public.exam_security_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Immutable Policy Snapshots Tied to Published Exam Versions
CREATE TABLE IF NOT EXISTS public.exam_security_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE RESTRICT,
  exam_version_id uuid NOT NULL UNIQUE REFERENCES public.exam_versions(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  policy_snapshot jsonb NOT NULL,
  snapshotted_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  snapshotted_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_exam_security_policy_versions_exam
  ON public.exam_security_policy_versions(exam_id, version_number DESC);

-- 4. Staff-Only Safe Exam Browser Key & Plist Profile Storage
CREATE TABLE IF NOT EXISTS public.secure_browser_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  exam_version_id uuid REFERENCES public.exam_versions(id) ON DELETE SET NULL,
  plist_xml text NOT NULL,
  config_key_hash text NOT NULL CHECK (config_key_hash ~* '^[a-f0-9]{64}$'),
  browser_exam_key_hash text CHECK (
    browser_exam_key_hash IS NULL OR browser_exam_key_hash ~* '^[a-f0-9]{64}$'
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_secure_browser_configs_active
  ON public.secure_browser_configs(exam_id, created_at DESC)
  WHERE is_active = true;

-- 5. Extend exam_attempts & attempt_events cleanly for Phase 4
ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS browser_platform text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS browser_trust_level text NOT NULL DEFAULT 'standard_browser',
  ADD COLUMN IF NOT EXISTS seb_verified_at_utc timestamptz,
  ADD COLUMN IF NOT EXISTS manual_browser_override_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_browser_override_reason text,
  ADD COLUMN IF NOT EXISTS manual_browser_override_until_utc timestamptz;

ALTER TABLE public.attempt_events
  ADD COLUMN IF NOT EXISTS client_event_id text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'INFORMATIONAL' CHECK (
    severity IN ('INFORMATIONAL', 'WARNING', 'REVIEW_REQUIRED')
  ),
  ADD COLUMN IF NOT EXISTS occurred_at_utc timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attempt_events_dedupe
  ON public.attempt_events(attempt_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attempt_events_severity
  ON public.attempt_events(attempt_id, severity, created_at_utc DESC);

-- 6. Compact Latest-Seen Heartbeat & Aggregate Counter State Per Attempt
CREATE TABLE IF NOT EXISTS public.attempt_monitoring_presence (
  attempt_id uuid PRIMARY KEY REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  last_heartbeat_at_utc timestamptz,
  presence_state text NOT NULL DEFAULT 'UNKNOWN' CHECK (
    presence_state IN ('RECENTLY_SEEN', 'STALE', 'UNKNOWN', 'ENDED')
  ),
  last_client_visible boolean NOT NULL DEFAULT true,
  last_client_online boolean NOT NULL DEFAULT true,
  last_queued_answer_count integer NOT NULL DEFAULT 0 CHECK (last_queued_answer_count >= 0),
  browser_platform text NOT NULL DEFAULT 'UNKNOWN',
  browser_trust_level text NOT NULL DEFAULT 'standard_browser',
  visibility_hidden_count integer NOT NULL DEFAULT 0 CHECK (visibility_hidden_count >= 0),
  reload_count integer NOT NULL DEFAULT 0 CHECK (reload_count >= 0),
  connection_gap_count integer NOT NULL DEFAULT 0 CHECK (connection_gap_count >= 0),
  copy_paste_count integer NOT NULL DEFAULT 0 CHECK (copy_paste_count >= 0),
  context_menu_count integer NOT NULL DEFAULT 0 CHECK (context_menu_count >= 0),
  highest_severity text NOT NULL DEFAULT 'INFORMATIONAL' CHECK (
    highest_severity IN ('INFORMATIONAL', 'WARNING', 'REVIEW_REQUIRED')
  ),
  stale_notified_at_utc timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_presence_exam_state
  ON public.attempt_monitoring_presence(school_id, exam_id, presence_state);
CREATE INDEX IF NOT EXISTS idx_presence_exam_severity
  ON public.attempt_monitoring_presence(exam_id, highest_severity, updated_at DESC);

CREATE TRIGGER trg_attempt_monitoring_presence_updated_at
  BEFORE UPDATE ON public.attempt_monitoring_presence
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Deduplicated Security Incidents & Teacher Review Workflow
CREATE TABLE IF NOT EXISTS public.exam_security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  reason_code text NOT NULL CHECK (
    reason_code IN (
      'PROLONGED_ABSENCE',
      'REPEATED_VISIBILITY_SWITCHES',
      'REPEATED_RELOADS',
      'COPY_PASTE_BURST',
      'PROLONGED_DISCONNECTION',
      'BROWSER_POLICY_MISMATCH',
      'MANUAL_STAFF_FLAG'
    )
  ),
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'NEW' CHECK (
    status IN ('NEW', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')
  ),
  severity text NOT NULL CHECK (
    severity IN ('INFORMATIONAL', 'WARNING', 'REVIEW_REQUIRED')
  ),
  title text NOT NULL,
  summary text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_observed_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_observed_at_utc timestamptz NOT NULL DEFAULT timezone('utc', now()),
  assigned_reviewer_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolution_summary text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_incidents_open_dedupe
  ON public.exam_security_incidents(exam_id, dedupe_key)
  WHERE status IN ('NEW', 'UNDER_REVIEW', 'ACKNOWLEDGED');

CREATE INDEX IF NOT EXISTS idx_security_incidents_exam_status
  ON public.exam_security_incidents(school_id, exam_id, status, severity, last_observed_at_utc DESC);

CREATE TRIGGER trg_exam_security_incidents_updated_at
  BEFORE UPDATE ON public.exam_security_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.exam_security_incident_events (
  incident_id uuid NOT NULL REFERENCES public.exam_security_incidents(id) ON DELETE CASCADE,
  attempt_event_id uuid NOT NULL REFERENCES public.attempt_events(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (incident_id, attempt_event_id)
);

-- 8. Immutable Incident Review Actions
CREATE TABLE IF NOT EXISTS public.incident_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES public.exam_security_incidents(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  previous_status text,
  new_status text NOT NULL CHECK (
    new_status IN ('NEW', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED')
  ),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_incident_review_actions_incident
  ON public.incident_review_actions(incident_id, created_at DESC);

-- 9. Immutable Monitoring & Override Audit Log
CREATE TABLE IF NOT EXISTS public.monitoring_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_monitoring_audit_school_created
  ON public.monitoring_audit_events(school_id, created_at DESC);

-- 10. Pre-Attempt & Active-Attempt Emergency Browser Policy Overrides
CREATE TABLE IF NOT EXISTS public.exam_student_browser_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  reason text NOT NULL,
  granted_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  valid_until_utc timestamptz NOT NULL,
  revoked_at_utc timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_exam_student_browser_override UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_student_browser_overrides_active
  ON public.exam_student_browser_overrides(exam_id, student_id, valid_until_utc)
  WHERE revoked_at_utc IS NULL;
