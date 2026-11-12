-- =============================================================================
-- UjianKita Phase 5: Security Audit, Role-Boundary & Snapshot Key Hardening
-- Fixes live PostgreSQL bugs verified during Phase 5 integration testing:
--   1. BUG-01: Aligns start_or_resume_exam_attempt with snake_case options_snapshot
--      written by publish_exam_atomic (while preserving camelCase fallback).
--   2. BUG-02: Closes auth_student_id() IS NULL ownership bypass in
--      record_attempt_heartbeat_atomic and record_monitoring_events_batch_atomic.
--   3. BUG-03: Adds proctor monitoring access, separates read-only auditor from
--      monitoring writes (auth_can_write_exam_monitoring), and enables scoped
--      same-school read RLS for monitoring staff across exam/student/audit views.
-- =============================================================================

-- 1. Monitoring Read & Write Authorization Helpers
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
        OR public.auth_has_role('proctor')
        OR public.auth_has_role('auditor')
        OR public.auth_can_manage_exam(e.id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_write_exam_monitoring(target_exam_id uuid)
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
        OR public.auth_has_role('proctor')
        OR public.auth_can_manage_exam(e.id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.auth_can_monitor_exam(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_can_write_exam_monitoring(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_can_monitor_exam(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_write_exam_monitoring(uuid) TO authenticated;

-- 2. Scoped Same-School Profile / Student / Audit / Monitoring Read RLS
CREATE OR REPLACE FUNCTION public.auth_can_read_profile(target_profile_id uuid, target_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    target_profile_id = auth.uid()
    OR public.auth_is_school_admin(target_school_id)
    OR EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.user_id = target_profile_id
        AND s.school_id = target_school_id
        AND (
          public.auth_teacher_teaches_student(s.id)
          OR (
            target_school_id = public.auth_school_id()
            AND (
              public.auth_has_role('proctor')
              OR public.auth_has_role('exam_coordinator')
              OR public.auth_has_role('auditor')
            )
          )
        )
    );
$$;

DROP POLICY IF EXISTS students_select_authorized ON public.students;
CREATE POLICY students_select_authorized ON public.students
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_school_admin(school_id)
    OR public.auth_teacher_teaches_student(id)
    OR (
      school_id = public.auth_school_id()
      AND (
        public.auth_has_role('proctor')
        OR public.auth_has_role('exam_coordinator')
        OR public.auth_has_role('auditor')
      )
    )
  );

DROP POLICY IF EXISTS exams_select_authorized ON public.exams;
CREATE POLICY exams_select_authorized ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.auth_can_access_subject_content(school_id, subject_id)
    OR public.auth_can_monitor_exam(id)
  );

DROP POLICY IF EXISTS exam_attempts_staff_select ON public.exam_attempts;
CREATE POLICY exam_attempts_staff_select ON public.exam_attempts
  FOR SELECT TO authenticated
  USING (
    public.auth_can_manage_exam(exam_id)
    OR public.auth_can_monitor_exam(exam_id)
  );

DROP POLICY IF EXISTS attempt_events_staff_select ON public.attempt_events;
CREATE POLICY attempt_events_staff_select ON public.attempt_events
  FOR SELECT TO authenticated
  USING (
    public.auth_teacher_can_grade_attempt(attempt_id)
    OR EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.id = attempt_events.attempt_id
        AND public.auth_can_monitor_exam(ea.exam_id)
    )
  );

DROP POLICY IF EXISTS audit_events_select_admin ON public.audit_events;
CREATE POLICY audit_events_select_admin ON public.audit_events
  FOR SELECT TO authenticated
  USING (
    public.auth_is_school_admin(school_id)
    OR (school_id = public.auth_school_id() AND public.auth_has_role('auditor'))
  );

-- Restrict browser override table direct writes away from read-only auditor
DROP POLICY IF EXISTS exam_student_browser_overrides_staff_write ON public.exam_student_browser_overrides;
CREATE POLICY exam_student_browser_overrides_staff_write ON public.exam_student_browser_overrides
  FOR ALL TO authenticated
  USING (public.auth_can_write_exam_monitoring(exam_id))
  WITH CHECK (public.auth_can_write_exam_monitoring(exam_id));

-- 3. BUG-01 Fix: start_or_resume_exam_attempt supports snake_case options_snapshot keys
CREATE OR REPLACE FUNCTION public.start_or_resume_exam_attempt(
  p_exam_id uuid,
  p_start_idempotency_key uuid DEFAULT NULL,
  p_client_timezone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_student public.students%ROWTYPE;
  v_enrollment public.class_enrollments%ROWTYPE;
  v_exam public.exams%ROWTYPE;
  v_version public.exam_versions%ROWTYPE;
  v_schedule public.exam_schedules%ROWTYPE;
  v_existing public.exam_attempts%ROWTYPE;
  v_prior_count integer := 0;
  v_deadline timestamptz;
  v_attempt_id uuid;
  v_late_cutoff timestamptz;
  v_total_q integer := 0;
  v_ordered_ids uuid[];
  v_unpinned_ids uuid[];
  v_pos_evq RECORD;
  v_idx integer := 1;
  v_unpinned_idx integer := 1;
  v_evq public.exam_version_questions%ROWTYPE;
  v_opt_item jsonb;
  v_opt_map jsonb;
  v_opt_snapshot jsonb;
  v_display_labels text[] := ARRAY['A','B','C','D','E','F','G','H'];
  v_opt_counter integer;
  v_canonical_key text;
  v_option_text text;
  v_display_key text;
  v_finalized_json jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.auth_has_role('student') THEN
    RAISE EXCEPTION 'UNAUTHORIZED_STUDENT';
  END IF;

  SELECT s.* INTO v_student
  FROM public.students s
  JOIN public.user_profiles up ON up.id = s.user_id
  WHERE s.user_id = v_uid
    AND s.is_active = true
    AND up.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INACTIVE_STUDENT_PROFILE';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND OR v_exam.school_id <> v_student.school_id THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  IF v_exam.status <> 'PUBLISHED' OR v_exam.published_version_id IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_PUBLISHED';
  END IF;

  SELECT * INTO v_version FROM public.exam_versions WHERE id = v_exam.published_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_VERSION_MISSING';
  END IF;

  SELECT ce.*, es.id AS _sched_id
  INTO v_enrollment
  FROM public.class_enrollments ce
  JOIN public.exam_assignments ea ON ea.exam_id = p_exam_id AND ea.class_id = ce.class_id
  JOIN public.exam_schedules es ON es.exam_id = p_exam_id AND es.class_id = ce.class_id
  WHERE ce.student_id = v_student.id
    AND ce.status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_CLASS_ASSIGNMENT';
  END IF;

  SELECT * INTO v_schedule
  FROM public.exam_schedules
  WHERE exam_id = p_exam_id AND class_id = v_enrollment.class_id;

  PERFORM pg_advisory_xact_lock(hashtext(p_exam_id::text || ':' || v_student.id::text));

  IF p_start_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.exam_attempts
    WHERE exam_id = p_exam_id
      AND student_id = v_student.id
      AND start_idempotency_key = p_start_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'attemptId', v_existing.id,
        'created', false,
        'resumed', true,
        'status', v_existing.status,
        'deadlineAtUtc', v_existing.deadline_at_utc,
        'serverNowUtc', v_now
      );
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.exam_attempts
  WHERE exam_id = p_exam_id
    AND student_id = v_student.id
    AND status IN ('IN_PROGRESS', 'SUBMITTING')
  FOR UPDATE;

  IF FOUND THEN
    IF v_now <= v_existing.deadline_at_utc THEN
      INSERT INTO public.attempt_events (
        school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
      ) VALUES (
        v_student.school_id, v_existing.id, v_uid, 'server_confirmed', 'ATTEMPT_RESUMED',
        jsonb_build_object('clientTimezone', p_client_timezone), v_now
      );

      RETURN jsonb_build_object(
        'attemptId', v_existing.id,
        'created', false,
        'resumed', true,
        'status', v_existing.status,
        'deadlineAtUtc', v_existing.deadline_at_utc,
        'serverNowUtc', v_now
      );
    ELSE
      v_finalized_json := public._finalize_attempt_internal(
        v_existing.id, gen_random_uuid(), true, v_uid, v_now
      );
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_prior_count
  FROM public.exam_attempts
  WHERE exam_id = p_exam_id AND student_id = v_student.id;

  IF v_prior_count >= v_schedule.max_attempts THEN
    RAISE EXCEPTION 'ATTEMPT_LIMIT_REACHED';
  END IF;

  IF v_now < v_schedule.starts_at THEN
    RAISE EXCEPTION 'EXAM_WINDOW_NOT_OPEN';
  END IF;

  IF v_now > v_schedule.ends_at THEN
    RAISE EXCEPTION 'EXAM_WINDOW_CLOSED';
  END IF;

  IF v_prior_count = 0 AND v_schedule.late_join_minutes > 0 THEN
    v_late_cutoff := v_schedule.starts_at + make_interval(mins => v_schedule.late_join_minutes);
    IF v_now > v_late_cutoff THEN
      RAISE EXCEPTION 'LATE_JOIN_CUTOFF_PASSED';
    END IF;
  END IF;

  v_deadline := LEAST(
    v_now + make_interval(mins => v_version.duration_minutes),
    v_schedule.ends_at
  );

  INSERT INTO public.exam_attempts (
    school_id,
    exam_id,
    exam_version_id,
    student_id,
    class_id,
    attempt_number,
    status,
    started_at_utc,
    deadline_at_utc,
    last_activity_at_utc,
    client_timezone,
    start_idempotency_key
  ) VALUES (
    v_student.school_id,
    p_exam_id,
    v_version.id,
    v_student.id,
    v_enrollment.class_id,
    v_prior_count + 1,
    'IN_PROGRESS',
    v_now,
    v_deadline,
    v_now,
    p_client_timezone,
    p_start_idempotency_key
  )
  RETURNING id INTO v_attempt_id;

  SELECT COUNT(*) INTO v_total_q
  FROM public.exam_version_questions
  WHERE exam_version_id = v_version.id;

  v_ordered_ids := array_fill(NULL::uuid, ARRAY[v_total_q]);

  IF v_version.randomize_questions THEN
    FOR v_pos_evq IN
      SELECT id, display_order
      FROM public.exam_version_questions
      WHERE exam_version_id = v_version.id AND preserve_question_position = true
      ORDER BY display_order ASC
    LOOP
      IF v_pos_evq.display_order >= 1 AND v_pos_evq.display_order <= v_total_q THEN
        v_ordered_ids[v_pos_evq.display_order] := v_pos_evq.id;
      END IF;
    END LOOP;

    SELECT ARRAY(
      SELECT id
      FROM public.exam_version_questions
      WHERE exam_version_id = v_version.id AND preserve_question_position = false
      ORDER BY sha256(convert_to(v_attempt_id::text || ':' || id::text, 'UTF8'))
    ) INTO v_unpinned_ids;

    FOR v_idx IN 1..v_total_q LOOP
      IF v_ordered_ids[v_idx] IS NULL AND v_unpinned_idx <= COALESCE(array_length(v_unpinned_ids, 1), 0) THEN
        v_ordered_ids[v_idx] := v_unpinned_ids[v_unpinned_idx];
        v_unpinned_idx := v_unpinned_idx + 1;
      END IF;
    END LOOP;
  ELSE
    SELECT ARRAY(
      SELECT id
      FROM public.exam_version_questions
      WHERE exam_version_id = v_version.id
      ORDER BY display_order ASC
    ) INTO v_ordered_ids;
  END IF;

  FOR v_idx IN 1..COALESCE(array_length(v_ordered_ids, 1), 0) LOOP
    SELECT * INTO v_evq
    FROM public.exam_version_questions
    WHERE id = v_ordered_ids[v_idx];

    v_opt_map := '{}'::jsonb;
    v_opt_snapshot := '[]'::jsonb;
    v_opt_counter := 0;

    IF v_version.randomize_options
      AND NOT v_evq.preserve_option_order
      AND v_evq.question_type NOT IN ('true_false', 'essay')
      AND jsonb_array_length(v_evq.options_snapshot) > 1 THEN

      FOR v_opt_item IN
        SELECT elem
        FROM jsonb_array_elements(v_evq.options_snapshot) AS elem
        ORDER BY sha256(
          convert_to(
            v_attempt_id::text || ':' || v_evq.id::text || ':' ||
            COALESCE(elem->>'option_key', elem->>'optionKey', ''),
            'UTF8'
          )
        )
      LOOP
        v_opt_counter := v_opt_counter + 1;
        v_canonical_key := COALESCE(v_opt_item ->> 'option_key', v_opt_item ->> 'optionKey');
        v_option_text := COALESCE(v_opt_item ->> 'option_text', v_opt_item ->> 'optionText', '');
        IF v_opt_counter <= array_length(v_display_labels, 1) THEN
          v_display_key := v_display_labels[v_opt_counter];
        ELSE
          v_display_key := v_canonical_key;
        END IF;

        v_opt_map := v_opt_map || jsonb_build_object(v_display_key, v_canonical_key);
        v_opt_snapshot := v_opt_snapshot || jsonb_build_array(
          jsonb_build_object(
            'optionKey', v_display_key,
            'optionText', v_option_text,
            'displayOrder', v_opt_counter - 1
          )
        );
      END LOOP;
    ELSE
      FOR v_opt_item IN
        SELECT elem
        FROM jsonb_array_elements(v_evq.options_snapshot) AS elem
        ORDER BY COALESCE(
          NULLIF(elem->>'display_order', '')::integer,
          NULLIF(elem->>'displayOrder', '')::integer,
          0
        ) ASC
      LOOP
        v_opt_counter := v_opt_counter + 1;
        v_canonical_key := COALESCE(v_opt_item ->> 'option_key', v_opt_item ->> 'optionKey');
        v_option_text := COALESCE(v_opt_item ->> 'option_text', v_opt_item ->> 'optionText', '');
        v_display_key := v_canonical_key;
        v_opt_map := v_opt_map || jsonb_build_object(v_display_key, v_canonical_key);
        v_opt_snapshot := v_opt_snapshot || jsonb_build_array(
          jsonb_build_object(
            'optionKey', v_display_key,
            'optionText', v_option_text,
            'displayOrder', v_opt_counter - 1
          )
        );
      END LOOP;
    END IF;

    INSERT INTO public.attempt_question_assignments (
      school_id,
      attempt_id,
      exam_version_question_id,
      display_index,
      question_type,
      stem_snapshot,
      points_snapshot,
      option_order_map,
      options_snapshot
    ) VALUES (
      v_student.school_id,
      v_attempt_id,
      v_evq.id,
      v_idx,
      v_evq.question_type,
      v_evq.stem,
      v_evq.points,
      v_opt_map,
      v_opt_snapshot
    );
  END LOOP;

  INSERT INTO public.attempt_events (
    school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
  ) VALUES (
    v_student.school_id, v_attempt_id, v_uid, 'server_confirmed', 'ATTEMPT_STARTED',
    jsonb_build_object(
      'attemptNumber', v_prior_count + 1,
      'examVersionId', v_version.id,
      'clientTimezone', p_client_timezone
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'attemptId', v_attempt_id,
    'created', true,
    'resumed', false,
    'status', 'IN_PROGRESS',
    'deadlineAtUtc', v_deadline,
    'serverNowUtc', v_now
  );
END;
$$;

-- 4. BUG-02 Fix: Enforce strict active student ownership on heartbeat & monitoring batch RPCs
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

  IF auth.uid() IS NOT NULL AND (v_student_id IS NULL OR v_attempt.student_id <> v_student_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_ATTEMPT_ACCESS';
  END IF;

  IF v_attempt.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN') THEN
    v_next_state := 'ENDED';
  END IF;

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
  v_occurred_at timestamptz;
  v_metadata jsonb;
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

  IF auth.uid() IS NOT NULL AND (v_student_id IS NULL OR v_attempt.student_id <> v_student_id) THEN
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

-- 5. BUG-03 Fix: Enforce monitoring write privileges (exclude read-only auditor)
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

  IF NOT public.auth_can_write_exam_monitoring(v_incident.exam_id) THEN
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

  IF NOT public.auth_can_write_exam_monitoring(v_attempt.exam_id) THEN
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
  IF auth.uid() IS NULL OR NOT public.auth_can_write_exam_monitoring(p_exam_id) THEN
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
