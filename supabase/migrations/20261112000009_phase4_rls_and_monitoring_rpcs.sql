-- ============================================================================
-- UjianKita Phase 4 Migration 000009: Immutability, Strict RLS Isolation,
-- Publish Policy Snapshotting & Atomic Monitoring / Incident RPC Functions
-- ============================================================================

-- 1. Immutability Triggers on Append-Only Monitoring Tables
DROP TRIGGER IF EXISTS trg_policy_versions_immutable ON public.exam_security_policy_versions;
CREATE TRIGGER trg_policy_versions_immutable
  BEFORE UPDATE OR DELETE ON public.exam_security_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_incident_review_actions_immutable ON public.incident_review_actions;
CREATE TRIGGER trg_incident_review_actions_immutable
  BEFORE UPDATE OR DELETE ON public.incident_review_actions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_monitoring_audit_events_immutable ON public.monitoring_audit_events;
CREATE TRIGGER trg_monitoring_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.monitoring_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

-- Controlled retention bypass trigger replacement on attempt_events so ONLY
-- authenticated retention RPC running inside session-local GUC can prune old telemetry.
CREATE OR REPLACE FUNCTION public.guard_attempt_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ujk.allow_retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'attempt_events is append-only; % operations are prohibited', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_attempt_events_immutable ON public.attempt_events;
CREATE TRIGGER trg_attempt_events_immutable
  BEFORE UPDATE OR DELETE ON public.attempt_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_attempt_events_mutation();

-- 2. Snapshot Security Policy Automatically When Exam Version Is Published
CREATE OR REPLACE FUNCTION public.snapshot_security_policy_on_exam_publish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_policy public.exam_security_policies%ROWTYPE;
  v_req_browser boolean := false;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_policy
  FROM public.exam_security_policies
  WHERE exam_id = NEW.exam_id;

  IF v_policy.id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.exam_schedules es
      WHERE es.exam_id = NEW.exam_id AND es.require_exam_browser = true
    ) INTO v_req_browser;

    v_snapshot := jsonb_build_object(
      'browser_policy', CASE WHEN v_req_browser THEN 'SECURE_BROWSER_RECOMMENDED' ELSE 'STANDARD_BROWSER_ALLOWED' END,
      'exambro_enabled', v_req_browser,
      'seb_enabled', v_req_browser,
      'seb_config_key_hash', NULL,
      'seb_browser_exam_key_hash', NULL,
      'seb_allow_standard_with_override', true,
      'copy_paste_guard_enabled', true,
      'context_menu_guard_enabled', true,
      'watermark_enabled', true,
      'watermark_opacity', 0.080,
      'heartbeat_interval_seconds', 30,
      'stale_threshold_seconds', 90,
      'visibility_switch_warn_threshold', 3,
      'visibility_switch_review_threshold', 6,
      'hidden_duration_review_seconds', 60,
      'reload_warn_threshold', 3,
      'reload_review_threshold', 5,
      'copy_paste_review_threshold', 3
    );
  ELSE
    v_snapshot := jsonb_build_object(
      'browser_policy', v_policy.browser_policy,
      'exambro_enabled', v_policy.exambro_enabled,
      'exambro_min_app_hint', v_policy.exambro_min_app_hint,
      'seb_enabled', v_policy.seb_enabled,
      'seb_config_key_hash', v_policy.seb_config_key_hash,
      'seb_browser_exam_key_hash', v_policy.seb_browser_exam_key_hash,
      'seb_allow_standard_with_override', v_policy.seb_allow_standard_with_override,
      'copy_paste_guard_enabled', v_policy.copy_paste_guard_enabled,
      'context_menu_guard_enabled', v_policy.context_menu_guard_enabled,
      'watermark_enabled', v_policy.watermark_enabled,
      'watermark_opacity', v_policy.watermark_opacity,
      'heartbeat_interval_seconds', v_policy.heartbeat_interval_seconds,
      'stale_threshold_seconds', v_policy.stale_threshold_seconds,
      'visibility_switch_warn_threshold', v_policy.visibility_switch_warn_threshold,
      'visibility_switch_review_threshold', v_policy.visibility_switch_review_threshold,
      'hidden_duration_review_seconds', v_policy.hidden_duration_review_seconds,
      'reload_warn_threshold', v_policy.reload_warn_threshold,
      'reload_review_threshold', v_policy.reload_review_threshold,
      'copy_paste_review_threshold', v_policy.copy_paste_review_threshold,
      'privacy_notice_text', v_policy.privacy_notice_text
    );
  END IF;

  INSERT INTO public.exam_security_policy_versions (
    school_id,
    exam_id,
    exam_version_id,
    version_number,
    policy_snapshot,
    snapshotted_by
  ) VALUES (
    NEW.school_id,
    NEW.exam_id,
    NEW.id,
    NEW.version_number,
    v_snapshot,
    auth.uid()
  )
  ON CONFLICT (exam_version_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_security_policy_on_publish ON public.exam_versions;
CREATE TRIGGER trg_snapshot_security_policy_on_publish
  AFTER INSERT ON public.exam_versions
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_security_policy_on_exam_publish();

-- 3. Enable RLS & Enforce Strict Least-Privilege Policies
ALTER TABLE public.exam_security_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_security_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_browser_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_monitoring_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_security_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_student_browser_overrides ENABLE ROW LEVEL SECURITY;

-- Tighten student visibility on attempt_events: never expose server SEB secrets/internals,
-- never allow client direct INSERT to forge `server_confirmed` or spoof large payloads.
DROP POLICY IF EXISTS attempt_events_student_select ON public.attempt_events;
CREATE POLICY attempt_events_student_select ON public.attempt_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = public.auth_student_id()
    )
    AND event_source = 'server_confirmed'
    AND event_type IN (
      'EXAM_SESSION_STARTED',
      'EXAM_SESSION_SUBMITTED',
      'EXAM_SESSION_EXPIRED'
    )
  );

DROP POLICY IF EXISTS attempt_events_student_insert ON public.attempt_events;
CREATE POLICY attempt_events_student_insert ON public.attempt_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = public.auth_student_id()
        AND att.status IN ('IN_PROGRESS', 'SUBMITTING')
    )
    AND event_source = 'client_reported'
    AND octet_length(metadata::text) <= 2048
  );

-- Staff monitoring helper
CREATE OR REPLACE FUNCTION public.auth_can_monitor_exam(target_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exams e
    WHERE e.id = target_exam_id
      AND e.school_id = public.auth_school_id()
      AND (
        public.auth_is_school_admin(e.school_id)
        OR public.auth_has_role('exam_coordinator')
        OR public.auth_has_role('auditor')
        OR public.auth_can_manage_exam(e.id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.auth_can_monitor_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_can_monitor_exam(uuid) TO authenticated;

-- Zero student SELECT on policies (may contain SEB BEK/ConfigKey hashes),
-- SEB configs, presence, incidents, review actions, or monitoring audit logs.
DROP POLICY IF EXISTS exam_security_policies_staff_select ON public.exam_security_policies;
CREATE POLICY exam_security_policies_staff_select ON public.exam_security_policies
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS exam_security_policies_staff_write ON public.exam_security_policies;
CREATE POLICY exam_security_policies_staff_write ON public.exam_security_policies
  FOR ALL TO authenticated
  USING (public.auth_can_manage_exam(exam_id) OR public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_can_manage_exam(exam_id) OR public.auth_is_school_admin(school_id));

DROP POLICY IF EXISTS exam_security_policy_versions_staff_select ON public.exam_security_policy_versions;
CREATE POLICY exam_security_policy_versions_staff_select ON public.exam_security_policy_versions
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS secure_browser_configs_staff_select ON public.secure_browser_configs;
CREATE POLICY secure_browser_configs_staff_select ON public.secure_browser_configs
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS secure_browser_configs_staff_write ON public.secure_browser_configs;
CREATE POLICY secure_browser_configs_staff_write ON public.secure_browser_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_manage_exam(exam_id) OR public.auth_is_school_admin(school_id));

DROP POLICY IF EXISTS attempt_monitoring_presence_staff_select ON public.attempt_monitoring_presence;
CREATE POLICY attempt_monitoring_presence_staff_select ON public.attempt_monitoring_presence
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS exam_security_incidents_staff_select ON public.exam_security_incidents;
CREATE POLICY exam_security_incidents_staff_select ON public.exam_security_incidents
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS exam_security_incident_events_staff_select ON public.exam_security_incident_events;
CREATE POLICY exam_security_incident_events_staff_select ON public.exam_security_incident_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_security_incidents esi
      WHERE esi.id = incident_id
        AND public.auth_can_monitor_exam(esi.exam_id)
    )
  );

DROP POLICY IF EXISTS incident_review_actions_staff_select ON public.incident_review_actions;
CREATE POLICY incident_review_actions_staff_select ON public.incident_review_actions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_security_incidents esi
      WHERE esi.id = incident_id
        AND public.auth_can_monitor_exam(esi.exam_id)
    )
  );

DROP POLICY IF EXISTS monitoring_audit_events_staff_select ON public.monitoring_audit_events;
CREATE POLICY monitoring_audit_events_staff_select ON public.monitoring_audit_events
  FOR SELECT TO authenticated
  USING (
    school_id = public.auth_school_id()
    AND (
      public.auth_is_school_admin(school_id)
      OR public.auth_has_role('exam_coordinator')
      OR public.auth_has_role('auditor')
      OR (exam_id IS NOT NULL AND public.auth_can_monitor_exam(exam_id))
    )
  );

-- 4. Atomic Heartbeat RPC (Compact upsert, zero permanent event spam)
CREATE OR REPLACE FUNCTION public.record_attempt_heartbeat_atomic(
  p_attempt_id uuid,
  p_visible boolean DEFAULT true,
  p_online boolean DEFAULT true,
  p_queued_answer_count integer DEFAULT 0,
  p_browser_platform_hint text DEFAULT 'STANDARD_WEB',
  p_exambro_hint boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_student_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_next_state text := 'RECENTLY_SEEN';
  v_effective_platform text;
  v_effective_trust text;
BEGIN
  v_student_id := public.auth_student_id();

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_student_id IS NOT NULL AND v_attempt.student_id <> v_student_id THEN
    RAISE EXCEPTION 'FORBIDDEN_ATTEMPT_ACCESS';
  END IF;

  IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN') THEN
    v_next_state := 'ENDED';
  END IF;

  -- Never allow a client heartbeat to upgrade trust level to verified SEB
  IF v_attempt.browser_trust_level IN ('verified_seb_header_and_key', 'verified_seb_js_key', 'staff_override') THEN
    v_effective_platform := v_attempt.browser_platform;
    v_effective_trust := v_attempt.browser_trust_level;
  ELSIF p_exambro_hint OR p_browser_platform_hint = 'ANDROID_EXAMBRO' THEN
    v_effective_platform := 'ANDROID_EXAMBRO';
    v_effective_trust := 'unverified_client_hint';
  ELSE
    v_effective_platform := COALESCE(NULLIF(p_browser_platform_hint, ''), 'STANDARD_WEB');
    v_effective_trust := 'standard_browser';
  END IF;

  IF v_attempt.status = 'IN_PROGRESS' THEN
    UPDATE public.exam_attempts
    SET
      last_activity_at_utc = v_now,
      browser_platform = v_effective_platform,
      browser_trust_level = v_effective_trust
    WHERE id = v_attempt.id;
  END IF;

  INSERT INTO public.attempt_monitoring_presence (
    attempt_id,
    school_id,
    exam_id,
    student_id,
    last_heartbeat_at_utc,
    presence_state,
    last_client_visible,
    last_client_online,
    last_queued_answer_count,
    browser_platform,
    browser_trust_level
  ) VALUES (
    v_attempt.id,
    v_attempt.school_id,
    v_attempt.exam_id,
    v_attempt.student_id,
    v_now,
    v_next_state,
    COALESCE(p_visible, true),
    COALESCE(p_online, true),
    GREATEST(0, COALESCE(p_queued_answer_count, 0)),
    v_effective_platform,
    v_effective_trust
  )
  ON CONFLICT (attempt_id) DO UPDATE SET
    last_heartbeat_at_utc = EXCLUDED.last_heartbeat_at_utc,
    presence_state = EXCLUDED.presence_state,
    last_client_visible = EXCLUDED.last_client_visible,
    last_client_online = EXCLUDED.last_client_online,
    last_queued_answer_count = EXCLUDED.last_queued_answer_count,
    browser_platform = EXCLUDED.browser_platform,
    browser_trust_level = EXCLUDED.browser_trust_level,
    stale_notified_at_utc = NULL;

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'presenceState', v_next_state,
    'recordedAtUtc', v_now,
    'browserTrustLevel', v_effective_trust
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_attempt_heartbeat_atomic(uuid, boolean, boolean, integer, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_attempt_heartbeat_atomic(uuid, boolean, boolean, integer, text, boolean) TO authenticated;

-- 5. Bounded & Deduplicated Client Event Batch Ingestion RPC
CREATE OR REPLACE FUNCTION public.record_monitoring_events_batch_atomic(
  p_attempt_id uuid,
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_student_id uuid;
  v_item jsonb;
  v_event_type text;
  v_client_event_id text;
  v_metadata jsonb;
  v_occurred_at timestamptz;
  v_inserted_id uuid;
  v_inserted_count integer := 0;
  v_deduped_count integer := 0;
  v_vis_delta integer := 0;
  v_reload_delta integer := 0;
  v_copy_delta integer := 0;
  v_ctx_delta integer := 0;
  v_severity text;
BEGIN
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_EVENTS_PAYLOAD';
  END IF;

  IF jsonb_array_length(p_events) > 25 THEN
    RAISE EXCEPTION 'TOO_MANY_EVENTS_IN_BATCH';
  END IF;

  v_student_id := public.auth_student_id();

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_student_id IS NOT NULL AND v_attempt.student_id <> v_student_id THEN
    RAISE EXCEPTION 'FORBIDDEN_ATTEMPT_ACCESS';
  END IF;

  IF v_attempt.status NOT IN ('IN_PROGRESS', 'SUBMITTING') THEN
    RETURN jsonb_build_object(
      'accepted', 0,
      'deduplicated', 0,
      'ignoredFinalized', true
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    v_event_type := COALESCE(v_item->>'eventType', '');
    v_client_event_id := NULLIF(btrim(COALESCE(v_item->>'clientEventId', '')), '');
    v_metadata := COALESCE(v_item->'metadata', '{}'::jsonb);

    IF octet_length(v_metadata::text) > 2048 THEN
      RAISE EXCEPTION 'EVENT_METADATA_TOO_LARGE';
    END IF;

    IF v_event_type NOT IN (
      'EXAM_PAGE_VISIBLE',
      'EXAM_PAGE_HIDDEN',
      'EXAM_PAGE_RELOADED',
      'EXAM_PAGE_NAVIGATION_OBSERVED',
      'CONNECTION_RESTORED',
      'COPY_EVENT_OBSERVED',
      'PASTE_EVENT_OBSERVED',
      'CONTEXT_MENU_EVENT_OBSERVED',
      'EXAMBRO_HINT_REPORTED'
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      v_occurred_at := COALESCE((v_item->>'occurredAt')::timestamptz, timezone('utc', now()));
    EXCEPTION WHEN OTHERS THEN
      v_occurred_at := timezone('utc', now());
    END;

    v_severity := CASE
      WHEN v_event_type IN ('COPY_EVENT_OBSERVED', 'PASTE_EVENT_OBSERVED', 'EXAM_PAGE_RELOADED') THEN 'WARNING'
      ELSE 'INFORMATIONAL'
    END;

    INSERT INTO public.attempt_events (
      school_id,
      attempt_id,
      actor_user_id,
      event_source,
      event_type,
      client_event_id,
      severity,
      occurred_at_utc,
      metadata
    ) VALUES (
      v_attempt.school_id,
      v_attempt.id,
      auth.uid(),
      'client_reported',
      v_event_type,
      v_client_event_id,
      v_severity,
      v_occurred_at,
      v_metadata
    )
    ON CONFLICT (attempt_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      v_deduped_count := v_deduped_count + 1;
    ELSE
      v_inserted_count := v_inserted_count + 1;
      IF v_event_type = 'EXAM_PAGE_HIDDEN' THEN
        v_vis_delta := v_vis_delta + 1;
      ELSIF v_event_type = 'EXAM_PAGE_RELOADED' THEN
        v_reload_delta := v_reload_delta + 1;
      ELSIF v_event_type IN ('COPY_EVENT_OBSERVED', 'PASTE_EVENT_OBSERVED') THEN
        v_copy_delta := v_copy_delta + 1;
      ELSIF v_event_type = 'CONTEXT_MENU_EVENT_OBSERVED' THEN
        v_ctx_delta := v_ctx_delta + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.attempt_monitoring_presence (
    attempt_id,
    school_id,
    exam_id,
    student_id,
    presence_state,
    visibility_hidden_count,
    reload_count,
    copy_paste_count,
    context_menu_count
  ) VALUES (
    v_attempt.id,
    v_attempt.school_id,
    v_attempt.exam_id,
    v_attempt.student_id,
    'RECENTLY_SEEN',
    v_vis_delta,
    v_reload_delta,
    v_copy_delta,
    v_ctx_delta
  )
  ON CONFLICT (attempt_id) DO UPDATE SET
    visibility_hidden_count = public.attempt_monitoring_presence.visibility_hidden_count + v_vis_delta,
    reload_count = public.attempt_monitoring_presence.reload_count + v_reload_delta,
    copy_paste_count = public.attempt_monitoring_presence.copy_paste_count + v_copy_delta,
    context_menu_count = public.attempt_monitoring_presence.context_menu_count + v_ctx_delta;

  RETURN jsonb_build_object(
    'accepted', v_inserted_count,
    'deduplicated', v_deduped_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_monitoring_events_batch_atomic(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_monitoring_events_batch_atomic(uuid, jsonb) TO authenticated;

-- 6. Staff Incident Review Transition RPC
CREATE OR REPLACE FUNCTION public.transition_security_incident_atomic(
  p_incident_id uuid,
  p_new_status text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_incident public.exam_security_incidents%ROWTYPE;
  v_prev_status text;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_new_status NOT IN ('NEW', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED') THEN
    RAISE EXCEPTION 'INVALID_INCIDENT_STATUS';
  END IF;

  SELECT * INTO v_incident
  FROM public.exam_security_incidents
  WHERE id = p_incident_id
  FOR UPDATE;

  IF v_incident.id IS NULL THEN
    RAISE EXCEPTION 'INCIDENT_NOT_FOUND';
  END IF;

  IF NOT public.auth_can_monitor_exam(v_incident.exam_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_INCIDENT_REVIEW';
  END IF;

  v_prev_status := v_incident.status;

  UPDATE public.exam_security_incidents
  SET
    status = p_new_status,
    assigned_reviewer_id = auth.uid(),
    resolution_summary = CASE
      WHEN p_new_status IN ('RESOLVED', 'DISMISSED') THEN p_note
      ELSE resolution_summary
    END,
    updated_at = v_now
  WHERE id = v_incident.id;

  INSERT INTO public.incident_review_actions (
    school_id,
    incident_id,
    actor_user_id,
    actor_role,
    previous_status,
    new_status,
    note
  ) VALUES (
    v_incident.school_id,
    v_incident.id,
    auth.uid(),
    'staff',
    v_prev_status,
    p_new_status,
    p_note
  );

  INSERT INTO public.monitoring_audit_events (
    school_id,
    exam_id,
    attempt_id,
    actor_user_id,
    actor_role,
    action,
    summary,
    metadata
  ) VALUES (
    v_incident.school_id,
    v_incident.exam_id,
    v_incident.attempt_id,
    auth.uid(),
    'staff',
    'monitoring.incident_status_changed',
    format('Status insiden diubah dari %s menjadi %s', v_prev_status, p_new_status),
    jsonb_build_object('incidentId', v_incident.id, 'previousStatus', v_prev_status, 'newStatus', p_new_status)
  );

  RETURN jsonb_build_object(
    'incidentId', v_incident.id,
    'previousStatus', v_prev_status,
    'newStatus', p_new_status,
    'updatedAt', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_security_incident_atomic(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_security_incident_atomic(uuid, text, text) TO authenticated;

-- 7. Emergency Browser Policy Override RPC (Staff-Only, Audited)
CREATE OR REPLACE FUNCTION public.grant_attempt_browser_override_atomic(
  p_attempt_id uuid,
  p_reason text,
  p_duration_minutes integer DEFAULT 240
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_until timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF NOT public.auth_can_monitor_exam(v_attempt.exam_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_BROWSER_OVERRIDE';
  END IF;

  v_until := v_now + make_interval(mins => GREATEST(15, LEAST(720, COALESCE(p_duration_minutes, 240))));

  UPDATE public.exam_attempts
  SET
    manual_browser_override_by = auth.uid(),
    manual_browser_override_reason = p_reason,
    manual_browser_override_until_utc = v_until,
    browser_trust_level = CASE
      WHEN browser_trust_level IN ('verified_seb_header_and_key', 'verified_seb_js_key') THEN browser_trust_level
      ELSE 'staff_override'
    END
  WHERE id = v_attempt.id;

  INSERT INTO public.attempt_events (
    school_id,
    attempt_id,
    actor_user_id,
    event_source,
    event_type,
    severity,
    occurred_at_utc,
    metadata
  ) VALUES (
    v_attempt.school_id,
    v_attempt.id,
    auth.uid(),
    'server_confirmed',
    'BROWSER_POLICY_OVERRIDE_GRANTED',
    'WARNING',
    v_now,
    jsonb_build_object('reason', p_reason, 'validUntilUtc', v_until)
  );

  INSERT INTO public.monitoring_audit_events (
    school_id,
    exam_id,
    attempt_id,
    actor_user_id,
    actor_role,
    action,
    summary,
    metadata
  ) VALUES (
    v_attempt.school_id,
    v_attempt.exam_id,
    v_attempt.id,
    auth.uid(),
    'staff',
    'monitoring.browser_override_granted',
    'Pengecualian darurat kebijakan peramban diberikan kepada siswa',
    jsonb_build_object('reason', p_reason, 'validUntilUtc', v_until)
  );

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'overrideUntilUtc', v_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_attempt_browser_override_atomic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_attempt_browser_override_atomic(uuid, text, integer) TO authenticated;

-- 8. Admin-Only Controlled Data Retention Purge RPC
CREATE OR REPLACE FUNCTION public.purge_expired_monitoring_records_atomic(
  p_school_id uuid,
  p_days_to_keep integer DEFAULT 90,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cutoff timestamptz := timezone('utc', now()) - make_interval(days => GREATEST(30, p_days_to_keep));
  v_events_count integer := 0;
  v_incidents_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.auth_is_school_admin(p_school_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_RETENTION_PURGE';
  END IF;

  SELECT COUNT(*) INTO v_events_count
  FROM public.attempt_events ae
  JOIN public.exam_attempts ea ON ea.id = ae.attempt_id
  WHERE ae.school_id = p_school_id
    AND ae.created_at_utc < v_cutoff
    AND ea.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN');

  SELECT COUNT(*) INTO v_incidents_count
  FROM public.exam_security_incidents esi
  WHERE esi.school_id = p_school_id
    AND esi.status IN ('RESOLVED', 'DISMISSED')
    AND esi.updated_at < v_cutoff;

  IF NOT p_dry_run THEN
    PERFORM set_config('ujk.allow_retention_purge', 'on', true);

    DELETE FROM public.attempt_events ae
    USING public.exam_attempts ea
    WHERE ae.attempt_id = ea.id
      AND ae.school_id = p_school_id
      AND ae.created_at_utc < v_cutoff
      AND ea.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN');

    DELETE FROM public.exam_security_incidents
    WHERE school_id = p_school_id
      AND status IN ('RESOLVED', 'DISMISSED')
      AND updated_at < v_cutoff;

    INSERT INTO public.monitoring_audit_events (
      school_id,
      actor_user_id,
      actor_role,
      action,
      summary,
      metadata
    ) VALUES (
      p_school_id,
      auth.uid(),
      'admin',
      'monitoring.retention_purged',
      format('Pembersihan data retensi (> %s hari): %s log aktivitas & %s insiden tertutup dihapus.', p_days_to_keep, v_events_count, v_incidents_count),
      jsonb_build_object('daysToKeep', p_days_to_keep, 'cutoffUtc', v_cutoff, 'deletedEvents', v_events_count, 'deletedIncidents', v_incidents_count)
    );
  END IF;

  RETURN jsonb_build_object(
    'dryRun', p_dry_run,
    'cutoffUtc', v_cutoff,
    'candidateEvents', v_events_count,
    'candidateIncidents', v_incidents_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_monitoring_records_atomic(uuid, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_monitoring_records_atomic(uuid, integer, boolean) TO authenticated;

DROP POLICY IF EXISTS exam_student_browser_overrides_staff_select ON public.exam_student_browser_overrides;
CREATE POLICY exam_student_browser_overrides_staff_select ON public.exam_student_browser_overrides
  FOR SELECT TO authenticated
  USING (public.auth_can_monitor_exam(exam_id));

DROP POLICY IF EXISTS exam_student_browser_overrides_staff_write ON public.exam_student_browser_overrides;
CREATE POLICY exam_student_browser_overrides_staff_write ON public.exam_student_browser_overrides
  FOR ALL TO authenticated
  USING (public.auth_can_monitor_exam(exam_id))
  WITH CHECK (public.auth_can_monitor_exam(exam_id));

CREATE OR REPLACE FUNCTION public.grant_student_exam_browser_override_atomic(
  p_exam_id uuid,
  p_student_id uuid,
  p_reason text,
  p_duration_minutes integer DEFAULT 240
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_school_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_until timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.auth_can_monitor_exam(p_exam_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_BROWSER_OVERRIDE';
  END IF;

  SELECT school_id INTO v_school_id FROM public.exams WHERE id = p_exam_id;
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  v_until := v_now + make_interval(mins => GREATEST(15, LEAST(720, COALESCE(p_duration_minutes, 240))));

  INSERT INTO public.exam_student_browser_overrides (
    school_id, exam_id, student_id, reason, granted_by, valid_until_utc, revoked_at_utc
  ) VALUES (
    v_school_id, p_exam_id, p_student_id, p_reason, auth.uid(), v_until, NULL
  )
  ON CONFLICT (exam_id, student_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    granted_by = EXCLUDED.granted_by,
    valid_until_utc = EXCLUDED.valid_until_utc,
    revoked_at_utc = NULL;

  UPDATE public.exam_attempts
  SET
    manual_browser_override_by = auth.uid(),
    manual_browser_override_reason = p_reason,
    manual_browser_override_until_utc = v_until,
    browser_trust_level = CASE
      WHEN browser_trust_level IN ('verified_seb_header_and_key', 'verified_seb_js_key') THEN browser_trust_level
      ELSE 'staff_override'
    END
  WHERE exam_id = p_exam_id
    AND student_id = p_student_id
    AND status = 'IN_PROGRESS';

  INSERT INTO public.monitoring_audit_events (
    school_id, exam_id, actor_user_id, actor_role, action, summary, metadata
  ) VALUES (
    v_school_id,
    p_exam_id,
    auth.uid(),
    'staff',
    'monitoring.browser_override_granted',
    'Pengecualian darurat kebijakan peramban diberikan kepada siswa',
    jsonb_build_object('studentId', p_student_id, 'reason', p_reason, 'validUntilUtc', v_until)
  );

  RETURN jsonb_build_object('examId', p_exam_id, 'studentId', p_student_id, 'overrideUntilUtc', v_until);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_student_exam_browser_override_atomic(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_student_exam_browser_override_atomic(uuid, uuid, text, integer) TO authenticated;
