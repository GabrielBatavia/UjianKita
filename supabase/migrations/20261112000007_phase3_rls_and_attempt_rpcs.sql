-- ============================================================================
-- UjianKita Phase 3 Migration 000007: Immutability Triggers, Least-Privilege
-- RLS Policies, Student Read Isolation & Atomic Examination Engine RPCs
-- ============================================================================

-- 1. Immutability protection for Phase 3 append-only tables & finalized records
DROP TRIGGER IF EXISTS trg_exam_submissions_immutable ON public.exam_submissions;
CREATE TRIGGER trg_exam_submissions_immutable
  BEFORE UPDATE OR DELETE ON public.exam_submissions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_submission_receipts_immutable ON public.submission_receipts;
CREATE TRIGGER trg_submission_receipts_immutable
  BEFORE UPDATE OR DELETE ON public.submission_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_answer_revisions_immutable ON public.answer_revisions;
CREATE TRIGGER trg_answer_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.answer_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_grade_adjustments_immutable ON public.grade_adjustments;
CREATE TRIGGER trg_grade_adjustments_immutable
  BEFORE UPDATE OR DELETE ON public.grade_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_attempt_events_immutable ON public.attempt_events;
CREATE TRIGGER trg_attempt_events_immutable
  BEFORE UPDATE OR DELETE ON public.attempt_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.guard_finalized_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN') THEN
    IF TG_OP = 'DELETE' AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Finalized exam attempt % cannot be deleted', OLD.id;
    END IF;
    IF TG_OP = 'UPDATE' AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.deadline_at_utc IS DISTINCT FROM OLD.deadline_at_utc
      OR NEW.submitted_at_utc IS DISTINCT FROM OLD.submitted_at_utc
      OR NEW.exam_version_id IS DISTINCT FROM OLD.exam_version_id
    ) THEN
      RAISE EXCEPTION 'Finalized exam attempt % is immutable (status=%)', OLD.id, OLD.status;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finalized_exam_attempts ON public.exam_attempts;
CREATE TRIGGER trg_guard_finalized_exam_attempts
  BEFORE UPDATE OR DELETE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_attempt_mutation();

CREATE OR REPLACE FUNCTION public.guard_finalized_student_answer_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.exam_attempts WHERE id = COALESCE(NEW.attempt_id, OLD.attempt_id);
  IF v_status IS NULL OR v_status NOT IN ('IN_PROGRESS', 'SUBMITTING') THEN
    RAISE EXCEPTION 'Cannot modify answers when attempt status is %', COALESCE(v_status, 'MISSING');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_finalized_student_answers ON public.student_answers;
CREATE TRIGGER trg_guard_finalized_student_answers
  BEFORE INSERT OR UPDATE OR DELETE ON public.student_answers
  FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_student_answer_writes();

-- 2. Phase 3 Auth / Authorization Helper Functions
CREATE OR REPLACE FUNCTION public.auth_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT s.id
  FROM public.students s
  JOIN public.user_profiles up ON up.id = s.user_id
  WHERE s.user_id = auth.uid()
    AND s.is_active = true
    AND up.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_student_can_access_exam(target_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exams e
    JOIN public.exam_assignments ea ON ea.exam_id = e.id
    JOIN public.exam_schedules es ON es.exam_id = e.id AND es.class_id = ea.class_id
    JOIN public.class_enrollments ce ON ce.class_id = ea.class_id
    JOIN public.students s ON s.id = ce.student_id
    JOIN public.user_profiles up ON up.id = s.user_id
    WHERE e.id = target_exam_id
      AND e.school_id = public.auth_school_id()
      AND e.status IN ('PUBLISHED', 'CLOSED')
      AND s.user_id = auth.uid()
      AND s.is_active = true
      AND up.is_active = true
      AND ce.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_teacher_can_grade_attempt(target_attempt_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_attempts att
    WHERE att.id = target_attempt_id
      AND public.auth_can_manage_exam(att.exam_id)
  );
$$;

REVOKE ALL ON FUNCTION public.auth_student_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_student_can_access_exam(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_teacher_can_grade_attempt(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_student_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_student_can_access_exam(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_teacher_can_grade_attempt(uuid) TO authenticated;

-- 3. Enable RLS on all Phase 3 tables
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_question_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_save_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_grading_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grade_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_events ENABLE ROW LEVEL SECURITY;

-- 4. Phase 2 Student Read-Only Policies (strictly PUBLISHED/CLOSED assigned exams;
--    NEVER grants students SELECT on answer keys, explanations, rubrics, or drafts)
DROP POLICY IF EXISTS exams_student_select ON public.exams;
CREATE POLICY exams_student_select ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND status IN ('PUBLISHED', 'CLOSED')
    AND public.auth_student_can_access_exam(id)
  );

DROP POLICY IF EXISTS exam_assignments_student_select ON public.exam_assignments;
CREATE POLICY exam_assignments_student_select ON public.exam_assignments
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND public.auth_student_in_class(class_id)
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_id AND e.status IN ('PUBLISHED', 'CLOSED')
    )
  );

DROP POLICY IF EXISTS exam_schedules_student_select ON public.exam_schedules;
CREATE POLICY exam_schedules_student_select ON public.exam_schedules
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND public.auth_student_in_class(class_id)
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_id AND e.status IN ('PUBLISHED', 'CLOSED')
    )
  );

DROP POLICY IF EXISTS exam_versions_student_select ON public.exam_versions;
CREATE POLICY exam_versions_student_select ON public.exam_versions
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND public.auth_student_can_access_exam(exam_id)
    AND EXISTS (
      SELECT 1 FROM public.exams e
      WHERE e.id = exam_id
        AND e.published_version_id = public.exam_versions.id
        AND e.status IN ('PUBLISHED', 'CLOSED')
    )
  );

-- 5. Least-Privilege RLS Policies for Phase 3 tables
-- Students & teachers read through strict policies; all authoritative mutations go via RPCs.

-- exam_attempts
DROP POLICY IF EXISTS exam_attempts_student_select ON public.exam_attempts;
CREATE POLICY exam_attempts_student_select ON public.exam_attempts
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND student_id = public.auth_student_id()
  );

DROP POLICY IF EXISTS exam_attempts_staff_select ON public.exam_attempts;
CREATE POLICY exam_attempts_staff_select ON public.exam_attempts
  FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam(exam_id));

-- attempt_question_assignments
DROP POLICY IF EXISTS attempt_qa_student_select ON public.attempt_question_assignments;
CREATE POLICY attempt_qa_student_select ON public.attempt_question_assignments
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id AND att.student_id = public.auth_student_id()
    )
  );

DROP POLICY IF EXISTS attempt_qa_staff_select ON public.attempt_question_assignments;
CREATE POLICY attempt_qa_staff_select ON public.attempt_question_assignments
  FOR SELECT TO authenticated
  USING (public.auth_teacher_can_grade_attempt(attempt_id));

-- student_answers
DROP POLICY IF EXISTS student_answers_student_select ON public.student_answers;
CREATE POLICY student_answers_student_select ON public.student_answers
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id AND att.student_id = public.auth_student_id()
    )
  );

DROP POLICY IF EXISTS student_answers_staff_select ON public.student_answers;
CREATE POLICY student_answers_staff_select ON public.student_answers
  FOR SELECT TO authenticated
  USING (public.auth_teacher_can_grade_attempt(attempt_id));

-- answer_revisions & answer_save_requests
DROP POLICY IF EXISTS answer_revisions_select ON public.answer_revisions;
CREATE POLICY answer_revisions_select ON public.answer_revisions
  FOR SELECT TO authenticated
  USING (
    (
      public.auth_has_role('student')
      AND school_id = public.auth_school_id()
      AND EXISTS (
        SELECT 1 FROM public.exam_attempts att
        WHERE att.id = attempt_id AND att.student_id = public.auth_student_id()
      )
    )
    OR public.auth_teacher_can_grade_attempt(attempt_id)
  );

DROP POLICY IF EXISTS answer_save_requests_select ON public.answer_save_requests;
CREATE POLICY answer_save_requests_select ON public.answer_save_requests
  FOR SELECT TO authenticated
  USING (
    (
      public.auth_has_role('student')
      AND school_id = public.auth_school_id()
      AND EXISTS (
        SELECT 1 FROM public.exam_attempts att
        WHERE att.id = attempt_id AND att.student_id = public.auth_student_id()
      )
    )
    OR public.auth_teacher_can_grade_attempt(attempt_id)
  );

-- exam_submissions & submission_receipts
DROP POLICY IF EXISTS exam_submissions_student_select ON public.exam_submissions;
CREATE POLICY exam_submissions_student_select ON public.exam_submissions
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND student_id = public.auth_student_id()
  );

DROP POLICY IF EXISTS exam_submissions_staff_select ON public.exam_submissions;
CREATE POLICY exam_submissions_staff_select ON public.exam_submissions
  FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam(exam_id));

DROP POLICY IF EXISTS submission_receipts_student_select ON public.submission_receipts;
CREATE POLICY submission_receipts_student_select ON public.submission_receipts
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND student_id = public.auth_student_id()
  );

DROP POLICY IF EXISTS submission_receipts_staff_select ON public.submission_receipts;
CREATE POLICY submission_receipts_staff_select ON public.submission_receipts
  FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam(exam_id));

-- exam_grades (students NEVER see unreleased results or pending essays unless released)
DROP POLICY IF EXISTS exam_grades_student_select ON public.exam_grades;
CREATE POLICY exam_grades_student_select ON public.exam_grades
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND student_id = public.auth_student_id()
    AND grading_status IN ('GRADED', 'ADJUSTED')
    AND (
      release_status = 'RELEASED'
      OR EXISTS (
        SELECT 1
        FROM public.exams e
        JOIN public.exam_attempts att ON att.id = exam_grades.attempt_id
        JOIN public.exam_schedules es ON es.exam_id = e.id AND es.class_id = att.class_id
        WHERE e.id = exam_grades.exam_id
          AND e.result_release_policy = 'after_window_close'
          AND timezone('utc', now()) >= es.ends_at
      )
    )
  );

DROP POLICY IF EXISTS exam_grades_staff_select ON public.exam_grades;
CREATE POLICY exam_grades_staff_select ON public.exam_grades
  FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam(exam_id));

-- manual_grading_entries & grade_adjustments (teacher/admin only; students cannot read raw rubrics/audit)
DROP POLICY IF EXISTS manual_grading_staff_select ON public.manual_grading_entries;
CREATE POLICY manual_grading_staff_select ON public.manual_grading_entries
  FOR SELECT TO authenticated
  USING (public.auth_teacher_can_grade_attempt(attempt_id));

DROP POLICY IF EXISTS grade_adjustments_staff_select ON public.grade_adjustments;
CREATE POLICY grade_adjustments_staff_select ON public.grade_adjustments
  FOR SELECT TO authenticated
  USING (public.auth_teacher_can_grade_attempt(attempt_id));

-- attempt_events
DROP POLICY IF EXISTS attempt_events_student_select ON public.attempt_events;
CREATE POLICY attempt_events_student_select ON public.attempt_events
  FOR SELECT TO authenticated
  USING (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id AND att.student_id = public.auth_student_id()
    )
  );

DROP POLICY IF EXISTS attempt_events_staff_select ON public.attempt_events;
CREATE POLICY attempt_events_staff_select ON public.attempt_events
  FOR SELECT TO authenticated
  USING (public.auth_teacher_can_grade_attempt(attempt_id));

-- Allow student client telemetry inserts strictly on their own IN_PROGRESS attempt with source='client_reported'
DROP POLICY IF EXISTS attempt_events_student_insert ON public.attempt_events;
CREATE POLICY attempt_events_student_insert ON public.attempt_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_has_role('student')
    AND school_id = public.auth_school_id()
    AND actor_user_id = auth.uid()
    AND event_source = 'client_reported'
    AND EXISTS (
      SELECT 1 FROM public.exam_attempts att
      WHERE att.id = attempt_id
        AND att.student_id = public.auth_student_id()
        AND att.status IN ('IN_PROGRESS', 'SUBMITTING')
    )
  );

-- 6. Internal Grading Calculation Helper (NOT directly callable by clients)
CREATE OR REPLACE FUNCTION public._compute_and_upsert_exam_grade(
  p_attempt_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS public.exam_grades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.exams%ROWTYPE;
  v_version public.exam_versions%ROWTYPE;
  v_existing_grade public.exam_grades%ROWTYPE;
  v_evq RECORD;
  v_objective_score numeric(12,4) := 0;
  v_manual_score numeric(12,4) := 0;
  v_max_score numeric(12,4) := 0;
  v_adjustment_delta numeric(12,4) := 0;
  v_total_score numeric(12,4) := 0;
  v_percentage numeric(6,2) := 0;
  v_pending_manual integer := 0;
  v_has_adjustment boolean := false;
  v_grading_status text;
  v_release_status text;
  v_released_by uuid;
  v_released_at timestamptz;
  v_sel_keys text[];
  v_key_keys text[];
  v_matched boolean;
  v_result public.exam_grades%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found for grading: %', p_attempt_id;
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = v_attempt.exam_id;
  SELECT * INTO v_version FROM public.exam_versions WHERE id = v_attempt.exam_version_id;
  SELECT * INTO v_existing_grade FROM public.exam_grades WHERE attempt_id = p_attempt_id;

  FOR v_evq IN
    SELECT
      evq.id AS evq_id,
      evq.question_type,
      evq.scoring_policy,
      evq.points,
      ak.correct_option_keys,
      sa.response_payload,
      mge.assigned_score
    FROM public.exam_version_questions evq
    LEFT JOIN public.exam_version_answer_keys ak ON ak.exam_version_question_id = evq.id
    LEFT JOIN public.student_answers sa
      ON sa.attempt_id = p_attempt_id AND sa.exam_version_question_id = evq.id
    LEFT JOIN public.manual_grading_entries mge
      ON mge.attempt_id = p_attempt_id AND mge.exam_version_question_id = evq.id
    WHERE evq.exam_version_id = v_attempt.exam_version_id
    ORDER BY evq.display_order ASC
  LOOP
    v_max_score := v_max_score + COALESCE(v_evq.points, 0);

    IF v_evq.question_type = 'essay' OR v_evq.scoring_policy = 'manual_rubric' THEN
      IF v_evq.assigned_score IS NULL THEN
        v_pending_manual := v_pending_manual + 1;
      ELSE
        v_manual_score := v_manual_score + LEAST(
          v_evq.points,
          GREATEST(0, ROUND(v_evq.assigned_score, 2))
        );
      END IF;
    ELSE
      v_matched := false;
      v_key_keys := ARRAY(
        SELECT DISTINCT btrim(x)
        FROM unnest(COALESCE(v_evq.correct_option_keys, '{}'::text[])) AS x
        WHERE btrim(x) <> ''
        ORDER BY 1
      );

      IF v_evq.response_payload IS NOT NULL THEN
        IF v_evq.question_type IN ('single_choice', 'true_false') THEN
          IF cardinality(v_key_keys) = 1
            AND btrim(COALESCE(
              v_evq.response_payload ->> 'canonicalOptionKey',
              v_evq.response_payload ->> 'selectedOptionKey',
              ''
            )) = v_key_keys[1] THEN
            v_matched := true;
          END IF;
        ELSIF v_evq.question_type = 'multiple_choice' THEN
          v_sel_keys := ARRAY(
            SELECT DISTINCT btrim(val)
            FROM jsonb_array_elements_text(
              COALESCE(
                v_evq.response_payload -> 'canonicalOptionKeys',
                v_evq.response_payload -> 'selectedOptionKeys',
                '[]'::jsonb
              )
            ) AS val
            WHERE btrim(val) <> ''
            ORDER BY 1
          );
          IF cardinality(v_key_keys) > 0 AND v_sel_keys = v_key_keys THEN
            v_matched := true;
          END IF;
        END IF;
      END IF;

      IF v_matched THEN
        v_objective_score := v_objective_score + v_evq.points;
      END IF;
    END IF;
  END LOOP;

  SELECT
    COALESCE(SUM(ga.adjustment_delta), 0),
    COUNT(*) > 0
  INTO v_adjustment_delta, v_has_adjustment
  FROM public.grade_adjustments ga
  WHERE ga.attempt_id = p_attempt_id;

  v_objective_score := ROUND(v_objective_score, 2);
  v_manual_score := ROUND(v_manual_score, 2);
  v_max_score := ROUND(v_max_score, 2);
  v_adjustment_delta := ROUND(v_adjustment_delta, 2);

  v_total_score := LEAST(
    v_max_score,
    GREATEST(0, ROUND(v_objective_score + v_manual_score + v_adjustment_delta, 2))
  );

  IF v_max_score > 0 THEN
    v_percentage := ROUND((v_total_score * 100.0) / v_max_score, 2);
  ELSE
    v_percentage := 0;
  END IF;

  IF v_pending_manual > 0 THEN
    v_grading_status := 'PENDING_MANUAL_REVIEW';
  ELSIF v_has_adjustment THEN
    v_grading_status := 'ADJUSTED';
  ELSE
    v_grading_status := 'GRADED';
  END IF;

  IF v_existing_grade.id IS NOT NULL AND v_existing_grade.release_status = 'RELEASED' THEN
    v_release_status := 'RELEASED';
    v_released_by := v_existing_grade.released_by;
    v_released_at := v_existing_grade.released_at_utc;
  ELSIF v_exam.result_release_policy = 'after_submit_if_no_essay'
    AND v_pending_manual = 0
    AND v_grading_status IN ('GRADED', 'ADJUSTED') THEN
    v_release_status := 'RELEASED';
    v_released_by := p_actor_user_id;
    v_released_at := p_now;
  ELSE
    v_release_status := 'UNRELEASED';
    v_released_by := NULL;
    v_released_at := NULL;
  END IF;

  INSERT INTO public.exam_grades (
    school_id,
    attempt_id,
    exam_id,
    student_id,
    grading_status,
    release_status,
    objective_score,
    manual_score,
    adjustment_delta,
    total_score,
    max_score,
    percentage_score,
    passed,
    pending_manual_count,
    graded_by,
    graded_at_utc,
    released_by,
    released_at_utc
  ) VALUES (
    v_attempt.school_id,
    v_attempt.id,
    v_attempt.exam_id,
    v_attempt.student_id,
    v_grading_status,
    v_release_status,
    v_objective_score,
    v_manual_score,
    v_adjustment_delta,
    v_total_score,
    v_max_score,
    v_percentage,
    v_percentage >= COALESCE(v_version.passing_score, 0),
    v_pending_manual,
    CASE WHEN v_pending_manual = 0 THEN p_actor_user_id ELSE NULL END,
    CASE WHEN v_pending_manual = 0 THEN p_now ELSE NULL END,
    v_released_by,
    v_released_at
  )
  ON CONFLICT (attempt_id) DO UPDATE SET
    grading_status = EXCLUDED.grading_status,
    release_status = EXCLUDED.release_status,
    objective_score = EXCLUDED.objective_score,
    manual_score = EXCLUDED.manual_score,
    adjustment_delta = EXCLUDED.adjustment_delta,
    total_score = EXCLUDED.total_score,
    max_score = EXCLUDED.max_score,
    percentage_score = EXCLUDED.percentage_score,
    passed = EXCLUDED.passed,
    pending_manual_count = EXCLUDED.pending_manual_count,
    graded_by = COALESCE(EXCLUDED.graded_by, public.exam_grades.graded_by),
    graded_at_utc = COALESCE(EXCLUDED.graded_at_utc, public.exam_grades.graded_at_utc),
    released_by = COALESCE(EXCLUDED.released_by, public.exam_grades.released_by),
    released_at_utc = COALESCE(EXCLUDED.released_at_utc, public.exam_grades.released_at_utc)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- 7. Internal Atomic Attempt Finalizer (shared by student submit, lazy expiration & batch timeout)
CREATE OR REPLACE FUNCTION public._finalize_attempt_internal(
  p_attempt_id uuid,
  p_idempotency_key uuid,
  p_is_auto_expire boolean,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_existing_receipt public.submission_receipts%ROWTYPE;
  v_final_status text;
  v_total_questions integer := 0;
  v_answered_count integer := 0;
  v_answers_digest text;
  v_integrity_digest text;
  v_submission_id uuid;
  v_receipt_id uuid;
  v_receipt_code text;
  v_grade public.exam_grades%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found: %', p_attempt_id;
  END IF;

  IF v_attempt.status = 'CANCELLED_BY_ADMIN' THEN
    RAISE EXCEPTION 'ATTEMPT_CANCELLED: Attempt % was cancelled by administrator', p_attempt_id;
  END IF;

  -- Idempotent return when already finalized
  IF v_attempt.status IN ('SUBMITTED', 'EXPIRED') THEN
    SELECT * INTO v_existing_receipt
    FROM public.submission_receipts
    WHERE attempt_id = p_attempt_id;

    RETURN jsonb_build_object(
      'idempotentReplay', true,
      'receiptId', v_existing_receipt.id,
      'receiptCode', v_existing_receipt.receipt_code,
      'attemptId', v_attempt.id,
      'examId', v_attempt.exam_id,
      'examVersionId', v_attempt.exam_version_id,
      'attemptStatus', v_attempt.status,
      'submittedAtUtc', v_attempt.submitted_at_utc,
      'answeredCount', v_existing_receipt.answered_count,
      'totalQuestions', v_existing_receipt.total_questions,
      'integrityDigest', v_existing_receipt.integrity_digest
    );
  END IF;

  -- Mark SUBMITTING momentarily within transaction guard
  UPDATE public.exam_attempts
  SET status = 'SUBMITTING'
  WHERE id = p_attempt_id;

  IF p_is_auto_expire OR p_now > v_attempt.deadline_at_utc THEN
    v_final_status := 'EXPIRED';
  ELSE
    v_final_status := 'SUBMITTED';
  END IF;

  SELECT COUNT(*) INTO v_total_questions
  FROM public.attempt_question_assignments
  WHERE attempt_id = p_attempt_id;

  SELECT COUNT(*) INTO v_answered_count
  FROM public.student_answers
  WHERE attempt_id = p_attempt_id AND has_answer = true;

  SELECT COALESCE(
    string_agg(
      aqa.exam_version_question_id::text || ':' || COALESCE(sa.latest_revision::text, '0') || ':' || COALESCE(sa.response_payload::text, '{}'),
      '|' ORDER BY aqa.display_index ASC
    ),
    ''
  )
  INTO v_answers_digest
  FROM public.attempt_question_assignments aqa
  LEFT JOIN public.student_answers sa
    ON sa.attempt_id = p_attempt_id AND sa.attempt_question_id = aqa.id
  WHERE aqa.attempt_id = p_attempt_id;

  v_integrity_digest := encode(
    sha256(
      convert_to(
        v_attempt.id::text || '|' || v_attempt.exam_version_id::text || '|' || p_now::text || '|'
        || v_answered_count::text || '|' || v_total_questions::text || '|' || v_answers_digest,
        'UTF8'
      )
    ),
    'hex'
  );

  UPDATE public.exam_attempts
  SET
    status = v_final_status,
    submitted_at_utc = p_now,
    last_activity_at_utc = p_now
  WHERE id = p_attempt_id;

  v_submission_id := gen_random_uuid();
  v_receipt_code := 'UJ-' || to_char(p_now, 'YYYYMMDD') || '-' || upper(substring(replace(v_submission_id::text, '-', ''), 1, 8));

  INSERT INTO public.exam_submissions (
    id,
    school_id,
    attempt_id,
    exam_id,
    student_id,
    submission_idempotency_key,
    final_status,
    answered_count,
    total_questions,
    submitted_by,
    submitted_at_utc
  ) VALUES (
    v_submission_id,
    v_attempt.school_id,
    v_attempt.id,
    v_attempt.exam_id,
    v_attempt.student_id,
    p_idempotency_key,
    v_final_status,
    v_answered_count,
    v_total_questions,
    p_actor_user_id,
    p_now
  );

  INSERT INTO public.submission_receipts (
    school_id,
    submission_id,
    attempt_id,
    exam_id,
    exam_version_id,
    student_id,
    receipt_code,
    answered_count,
    total_questions,
    integrity_digest,
    issued_at_utc
  ) VALUES (
    v_attempt.school_id,
    v_submission_id,
    v_attempt.id,
    v_attempt.exam_id,
    v_attempt.exam_version_id,
    v_attempt.student_id,
    v_receipt_code,
    v_answered_count,
    v_total_questions,
    v_integrity_digest,
    p_now
  )
  RETURNING id INTO v_receipt_id;

  v_grade := public._compute_and_upsert_exam_grade(p_attempt_id, p_actor_user_id, p_now);

  INSERT INTO public.attempt_events (
    school_id,
    attempt_id,
    actor_user_id,
    event_source,
    event_type,
    metadata,
    created_at_utc
  ) VALUES (
    v_attempt.school_id,
    v_attempt.id,
    p_actor_user_id,
    CASE WHEN p_is_auto_expire THEN 'server_inferred' ELSE 'server_confirmed' END,
    CASE WHEN v_final_status = 'EXPIRED' THEN 'ATTEMPT_EXPIRED' ELSE 'SUBMISSION_COMMITTED' END,
    jsonb_build_object(
      'receiptCode', v_receipt_code,
      'answeredCount', v_answered_count,
      'totalQuestions', v_total_questions,
      'gradingStatus', v_grade.grading_status
    ),
    p_now
  );

  IF v_grade.grading_status = 'GRADED' THEN
    INSERT INTO public.attempt_events (
      school_id,
      attempt_id,
      actor_user_id,
      event_source,
      event_type,
      metadata,
      created_at_utc
    ) VALUES (
      v_attempt.school_id,
      v_attempt.id,
      p_actor_user_id,
      'server_confirmed',
      'GRADE_FINALIZED',
      jsonb_build_object(
        'objectiveScore', v_grade.objective_score,
        'totalScore', v_grade.total_score,
        'percentageScore', v_grade.percentage_score,
        'releaseStatus', v_grade.release_status
      ),
      p_now
    );
  END IF;

  RETURN jsonb_build_object(
    'idempotentReplay', false,
    'receiptId', v_receipt_id,
    'receiptCode', v_receipt_code,
    'attemptId', v_attempt.id,
    'examId', v_attempt.exam_id,
    'examVersionId', v_attempt.exam_version_id,
    'attemptStatus', v_final_status,
    'submittedAtUtc', p_now,
    'answeredCount', v_answered_count,
    'totalQuestions', v_total_questions,
    'integrityDigest', v_integrity_digest
  );
END;
$$;

REVOKE ALL ON FUNCTION public._compute_and_upsert_exam_grade(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._finalize_attempt_internal(uuid, uuid, boolean, uuid, timestamptz) FROM PUBLIC;

-- 8. Public RPC: Start or Resume Student Exam Attempt (Atomic + Deterministic Shuffle)
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
  v_opt_array jsonb;
  v_opt_item jsonb;
  v_opt_map jsonb;
  v_opt_snapshot jsonb;
  v_display_labels text[] := ARRAY['A','B','C','D','E','F','G','H'];
  v_opt_counter integer;
  v_canonical_key text;
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

  -- Locate student's active enrolled class matching exam assignment & schedule
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

  -- Serialize concurrent start/resume requests for same student + exam
  PERFORM pg_advisory_xact_lock(hashtext(p_exam_id::text || ':' || v_student.id::text));

  -- Check idempotent replay of an identical start_idempotency_key
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

  -- Resume active attempt if one exists
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
      -- Close expired active session automatically before checking next attempt eligibility
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

  -- Build deterministic per-attempt question order respecting pinned positions
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

  -- Insert realized question assignments with deterministic option shuffling & option_order_map
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
          convert_to(v_attempt_id::text || ':' || v_evq.id::text || ':' || COALESCE(elem->>'optionKey', ''), 'UTF8')
        )
      LOOP
        v_opt_counter := v_opt_counter + 1;
        v_canonical_key := v_opt_item ->> 'optionKey';
        IF v_opt_counter <= array_length(v_display_labels, 1) THEN
          v_display_key := v_display_labels[v_opt_counter];
        ELSE
          v_display_key := v_canonical_key;
        END IF;

        v_opt_map := v_opt_map || jsonb_build_object(v_display_key, v_canonical_key);
        v_opt_snapshot := v_opt_snapshot || jsonb_build_array(
          jsonb_build_object(
            'optionKey', v_display_key,
            'optionText', v_opt_item ->> 'optionText',
            'displayOrder', v_opt_counter - 1
          )
        );
      END LOOP;
    ELSE
      FOR v_opt_item IN
        SELECT elem
        FROM jsonb_array_elements(v_evq.options_snapshot) AS elem
        ORDER BY COALESCE((elem->>'displayOrder')::integer, 0) ASC
      LOOP
        v_opt_counter := v_opt_counter + 1;
        v_canonical_key := v_opt_item ->> 'optionKey';
        v_display_key := v_canonical_key;
        v_opt_map := v_opt_map || jsonb_build_object(v_display_key, v_canonical_key);
        v_opt_snapshot := v_opt_snapshot || jsonb_build_array(
          jsonb_build_object(
            'optionKey', v_display_key,
            'optionText', v_opt_item ->> 'optionText',
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

-- 9. Public RPC: Monotonic & Idempotent Answer Save
CREATE OR REPLACE FUNCTION public.save_attempt_answer_atomic(
  p_attempt_id uuid,
  p_attempt_question_id uuid,
  p_idempotency_key uuid,
  p_client_revision integer,
  p_response_payload jsonb,
  p_payload_hash text,
  p_is_flagged boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_student_id uuid := public.auth_student_id();
  v_attempt public.exam_attempts%ROWTYPE;
  v_assignment public.attempt_question_assignments%ROWTYPE;
  v_existing_req public.answer_save_requests%ROWTYPE;
  v_existing_ans public.student_answers%ROWTYPE;
  v_current_rev integer := 0;
  v_req_type text;
  v_selected_key text;
  v_canonical_key text;
  v_selected_arr jsonb := '[]'::jsonb;
  v_canonical_arr jsonb := '[]'::jsonb;
  v_text_answer text;
  v_elem text;
  v_has_answer boolean := false;
  v_normalized_payload jsonb;
  v_flag_value boolean := false;
BEGIN
  IF v_uid IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_STUDENT';
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND OR v_attempt.student_id <> v_student_id THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing_ans
  FROM public.student_answers
  WHERE attempt_id = p_attempt_id AND attempt_question_id = p_attempt_question_id
  FOR UPDATE;

  v_current_rev := COALESCE(v_existing_ans.latest_revision, 0);

  -- Idempotency lookup
  SELECT * INTO v_existing_req
  FROM public.answer_save_requests
  WHERE attempt_id = p_attempt_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_req.request_hash <> p_payload_hash THEN
      RETURN jsonb_build_object(
        'outcome', 'IDEMPOTENCY_CONFLICT',
        'attemptId', p_attempt_id,
        'attemptQuestionId', p_attempt_question_id,
        'authoritativeRevision', v_current_rev,
        'committedAtUtc', v_existing_ans.committed_at_utc,
        'serverNowUtc', v_now,
        'message', 'Kunci idempotensi digunakan ulang untuk muatan jawaban berbeda.'
      );
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'IDEMPOTENT_REPLAY',
      'attemptId', p_attempt_id,
      'attemptQuestionId', p_attempt_question_id,
      'authoritativeRevision', v_current_rev,
      'committedAtUtc', v_existing_req.committed_at_utc,
      'serverNowUtc', v_now
    );
  END IF;

  IF v_attempt.status = 'CANCELLED_BY_ADMIN' THEN
    RETURN jsonb_build_object(
      'outcome', 'ATTEMPT_CANCELLED',
      'attemptId', p_attempt_id,
      'attemptQuestionId', p_attempt_question_id,
      'authoritativeRevision', v_current_rev,
      'committedAtUtc', NULL,
      'serverNowUtc', v_now,
      'message', 'Sesi ujian ini telah dibatalkan oleh administrator.'
    );
  END IF;

  IF v_attempt.status IN ('SUBMITTED', 'EXPIRED') THEN
    RETURN jsonb_build_object(
      'outcome', 'ATTEMPT_ALREADY_SUBMITTED',
      'attemptId', p_attempt_id,
      'attemptQuestionId', p_attempt_question_id,
      'authoritativeRevision', v_current_rev,
      'committedAtUtc', NULL,
      'serverNowUtc', v_now,
      'message', 'Ujian telah dikumpulkan sehingga jawaban tidak dapat diubah lagi.'
    );
  END IF;

  IF v_now > v_attempt.deadline_at_utc THEN
    PERFORM public._finalize_attempt_internal(p_attempt_id, gen_random_uuid(), true, v_uid, v_now);
    RETURN jsonb_build_object(
      'outcome', 'DEADLINE_EXPIRED',
      'attemptId', p_attempt_id,
      'attemptQuestionId', p_attempt_question_id,
      'authoritativeRevision', v_current_rev,
      'committedAtUtc', NULL,
      'serverNowUtc', v_now,
      'message', 'Batas waktu server telah berakhir dan sesi otomatis difinalisasi.'
    );
  END IF;

  IF p_client_revision <= v_current_rev THEN
    RETURN jsonb_build_object(
      'outcome', 'STALE_REVISION_REJECTED',
      'attemptId', p_attempt_id,
      'attemptQuestionId', p_attempt_question_id,
      'authoritativeRevision', v_current_rev,
      'committedAtUtc', v_existing_ans.committed_at_utc,
      'serverNowUtc', v_now,
      'message', 'Revisi jawaban lebih lama daripada revisi terbaru di server.'
    );
  END IF;

  SELECT * INTO v_assignment
  FROM public.attempt_question_assignments
  WHERE id = p_attempt_question_id AND attempt_id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_NOT_IN_ATTEMPT';
  END IF;

  v_req_type := p_response_payload ->> 'questionType';
  IF v_req_type IS DISTINCT FROM v_assignment.question_type THEN
    RAISE EXCEPTION 'QUESTION_TYPE_MISMATCH';
  END IF;

  IF v_assignment.question_type IN ('single_choice', 'true_false') THEN
    v_selected_key := p_response_payload ->> 'selectedOptionKey';
    IF v_selected_key IS NOT NULL AND btrim(v_selected_key) <> '' THEN
      IF NOT (v_assignment.option_order_map ? v_selected_key) THEN
        RAISE EXCEPTION 'INVALID_OPTION_KEY';
      END IF;
      v_canonical_key := v_assignment.option_order_map ->> v_selected_key;
      v_has_answer := true;
    ELSE
      v_selected_key := NULL;
      v_canonical_key := NULL;
      v_has_answer := false;
    END IF;

    v_normalized_payload := jsonb_build_object(
      'questionType', v_assignment.question_type,
      'selectedOptionKey', v_selected_key,
      'canonicalOptionKey', v_canonical_key
    );

  ELSIF v_assignment.question_type = 'multiple_choice' THEN
    FOR v_elem IN
      SELECT DISTINCT btrim(val)
      FROM jsonb_array_elements_text(COALESCE(p_response_payload -> 'selectedOptionKeys', '[]'::jsonb)) AS val
      WHERE btrim(val) <> ''
      ORDER BY 1
    LOOP
      IF NOT (v_assignment.option_order_map ? v_elem) THEN
        RAISE EXCEPTION 'INVALID_OPTION_KEY';
      END IF;
      v_selected_arr := v_selected_arr || to_jsonb(v_elem);
      v_canonical_arr := v_canonical_arr || to_jsonb(v_assignment.option_order_map ->> v_elem);
    END LOOP;

    v_has_answer := jsonb_array_length(v_selected_arr) > 0;
    v_normalized_payload := jsonb_build_object(
      'questionType', 'multiple_choice',
      'selectedOptionKeys', v_selected_arr,
      'canonicalOptionKeys', v_canonical_arr
    );

  ELSE
    v_text_answer := COALESCE(p_response_payload ->> 'textAnswer', '');
    IF char_length(v_text_answer) > 30000 THEN
      RAISE EXCEPTION 'ESSAY_TOO_LONG';
    END IF;
    v_has_answer := length(btrim(v_text_answer)) > 0;
    v_normalized_payload := jsonb_build_object(
      'questionType', 'essay',
      'textAnswer', v_text_answer
    );
  END IF;

  v_flag_value := COALESCE(p_is_flagged, v_existing_ans.is_flagged_for_review, false);

  INSERT INTO public.student_answers (
    school_id,
    attempt_id,
    attempt_question_id,
    exam_version_question_id,
    latest_revision,
    idempotency_key,
    response_payload,
    is_flagged_for_review,
    has_answer,
    committed_at_utc
  ) VALUES (
    v_attempt.school_id,
    p_attempt_id,
    p_attempt_question_id,
    v_assignment.exam_version_question_id,
    p_client_revision,
    p_idempotency_key,
    v_normalized_payload,
    v_flag_value,
    v_has_answer,
    v_now
  )
  ON CONFLICT (attempt_id, attempt_question_id) DO UPDATE SET
    latest_revision = EXCLUDED.latest_revision,
    idempotency_key = EXCLUDED.idempotency_key,
    response_payload = EXCLUDED.response_payload,
    is_flagged_for_review = COALESCE(p_is_flagged, public.student_answers.is_flagged_for_review),
    has_answer = EXCLUDED.has_answer,
    committed_at_utc = EXCLUDED.committed_at_utc;

  INSERT INTO public.answer_revisions (
    school_id,
    attempt_id,
    attempt_question_id,
    revision,
    idempotency_key,
    response_payload,
    committed_at_utc
  ) VALUES (
    v_attempt.school_id,
    p_attempt_id,
    p_attempt_question_id,
    p_client_revision,
    p_idempotency_key,
    v_normalized_payload,
    v_now
  );

  INSERT INTO public.answer_save_requests (
    school_id,
    attempt_id,
    attempt_question_id,
    idempotency_key,
    request_hash,
    client_revision,
    outcome,
    committed_at_utc
  ) VALUES (
    v_attempt.school_id,
    p_attempt_id,
    p_attempt_question_id,
    p_idempotency_key,
    p_payload_hash,
    p_client_revision,
    'COMMITTED',
    v_now
  );

  UPDATE public.exam_attempts
  SET last_activity_at_utc = v_now
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object(
    'outcome', 'COMMITTED',
    'attemptId', p_attempt_id,
    'attemptQuestionId', p_attempt_question_id,
    'authoritativeRevision', p_client_revision,
    'committedAtUtc', v_now,
    'serverNowUtc', v_now
  );
END;
$$;

-- 10. Public RPC: Toggle Flag-for-Review Independently
CREATE OR REPLACE FUNCTION public.toggle_attempt_question_flag(
  p_attempt_id uuid,
  p_attempt_question_id uuid,
  p_is_flagged boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_student_id uuid := public.auth_student_id();
  v_attempt public.exam_attempts%ROWTYPE;
  v_assignment public.attempt_question_assignments%ROWTYPE;
  v_empty_payload jsonb;
BEGIN
  IF v_uid IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_STUDENT';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.student_id <> v_student_id THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt.status NOT IN ('IN_PROGRESS', 'SUBMITTING') THEN
    RAISE EXCEPTION 'ATTEMPT_ALREADY_FINALIZED';
  END IF;

  IF v_now > v_attempt.deadline_at_utc THEN
    PERFORM public._finalize_attempt_internal(p_attempt_id, gen_random_uuid(), true, v_uid, v_now);
    RAISE EXCEPTION 'DEADLINE_EXPIRED';
  END IF;

  SELECT * INTO v_assignment
  FROM public.attempt_question_assignments
  WHERE id = p_attempt_question_id AND attempt_id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_NOT_IN_ATTEMPT';
  END IF;

  v_empty_payload := CASE
    WHEN v_assignment.question_type = 'multiple_choice' THEN jsonb_build_object('questionType', 'multiple_choice', 'selectedOptionKeys', '[]'::jsonb, 'canonicalOptionKeys', '[]'::jsonb)
    WHEN v_assignment.question_type = 'essay' THEN jsonb_build_object('questionType', 'essay', 'textAnswer', '')
    ELSE jsonb_build_object('questionType', v_assignment.question_type, 'selectedOptionKey', NULL, 'canonicalOptionKey', NULL)
  END;

  INSERT INTO public.student_answers (
    school_id,
    attempt_id,
    attempt_question_id,
    exam_version_question_id,
    latest_revision,
    idempotency_key,
    response_payload,
    is_flagged_for_review,
    has_answer,
    committed_at_utc
  ) VALUES (
    v_attempt.school_id,
    p_attempt_id,
    p_attempt_question_id,
    v_assignment.exam_version_question_id,
    0,
    gen_random_uuid(),
    v_empty_payload,
    p_is_flagged,
    false,
    v_now
  )
  ON CONFLICT (attempt_id, attempt_question_id) DO UPDATE SET
    is_flagged_for_review = p_is_flagged;

  RETURN jsonb_build_object(
    'attemptId', p_attempt_id,
    'attemptQuestionId', p_attempt_question_id,
    'isFlaggedForReview', p_is_flagged,
    'serverNowUtc', v_now
  );
END;
$$;

-- 11. Public RPCs: Student Submit & Lazy Expiration Enforcement
CREATE OR REPLACE FUNCTION public.submit_exam_attempt_atomic(
  p_attempt_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_student_id uuid := public.auth_student_id();
  v_attempt public.exam_attempts%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED_STUDENT';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.student_id <> v_student_id THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  RETURN public._finalize_attempt_internal(
    p_attempt_id,
    p_idempotency_key,
    v_now > v_attempt.deadline_at_utc,
    v_uid,
    v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_expired_attempt_on_access(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_student_id uuid := public.auth_student_id();
  v_attempt public.exam_attempts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF NOT (
    (v_student_id IS NOT NULL AND v_attempt.student_id = v_student_id)
    OR public.auth_can_manage_exam(v_attempt.exam_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN_ATTEMPT_ACCESS';
  END IF;

  IF v_attempt.status IN ('IN_PROGRESS', 'SUBMITTING') AND v_now > v_attempt.deadline_at_utc THEN
    RETURN public._finalize_attempt_internal(
      p_attempt_id,
      gen_random_uuid(),
      true,
      v_uid,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status,
    'deadlineAtUtc', v_attempt.deadline_at_utc,
    'serverNowUtc', v_now
  );
END;
$$;

-- Portable service-only batch expiration worker (works from cron/scheduler with zero user JWT)
CREATE OR REPLACE FUNCTION public.finalize_expired_exam_attempts(
  p_exam_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_row RECORD;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.exam_attempts
    WHERE status IN ('IN_PROGRESS', 'SUBMITTING')
      AND deadline_at_utc < v_now
      AND (p_exam_id IS NULL OR exam_id = p_exam_id)
    ORDER BY deadline_at_utc ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public._finalize_attempt_internal(v_row.id, gen_random_uuid(), true, NULL, v_now);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 12. Teacher / Admin Grading, Adjustment, Release & Cancellation RPCs
CREATE OR REPLACE FUNCTION public.grade_essay_and_recalculate_atomic(
  p_attempt_id uuid,
  p_entries jsonb,
  p_release_if_complete boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_attempt public.exam_attempts%ROWTYPE;
  v_entry jsonb;
  v_evq_id uuid;
  v_score numeric;
  v_feedback text;
  v_evq public.exam_version_questions%ROWTYPE;
  v_grade public.exam_grades%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.auth_teacher_can_grade_attempt(p_attempt_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_GRADING';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt.status NOT IN ('SUBMITTED', 'EXPIRED') THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FINALIZED';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_evq_id := (v_entry ->> 'examVersionQuestionId')::uuid;
    v_score := ROUND((v_entry ->> 'assignedScore')::numeric, 2);
    v_feedback := NULLIF(btrim(COALESCE(v_entry ->> 'feedback', '')), '');

    SELECT * INTO v_evq
    FROM public.exam_version_questions
    WHERE id = v_evq_id AND exam_version_id = v_attempt.exam_version_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'QUESTION_NOT_IN_EXAM_VERSION';
    END IF;

    IF v_evq.question_type <> 'essay' AND v_evq.scoring_policy <> 'manual_rubric' THEN
      RAISE EXCEPTION 'QUESTION_NOT_MANUAL_ESSAY';
    END IF;

    IF v_score < 0 OR v_score > v_evq.points THEN
      RAISE EXCEPTION 'SCORE_OUT_OF_RANGE';
    END IF;

    INSERT INTO public.manual_grading_entries (
      school_id,
      attempt_id,
      exam_version_question_id,
      assigned_score,
      max_points,
      feedback,
      grader_user_id,
      graded_at_utc
    ) VALUES (
      v_attempt.school_id,
      p_attempt_id,
      v_evq_id,
      v_score,
      v_evq.points,
      v_feedback,
      v_uid,
      v_now
    )
    ON CONFLICT (attempt_id, exam_version_question_id) DO UPDATE SET
      assigned_score = EXCLUDED.assigned_score,
      feedback = EXCLUDED.feedback,
      grader_user_id = EXCLUDED.grader_user_id,
      graded_at_utc = EXCLUDED.graded_at_utc;
  END LOOP;

  v_grade := public._compute_and_upsert_exam_grade(p_attempt_id, v_uid, v_now);

  IF p_release_if_complete
    AND v_grade.pending_manual_count = 0
    AND v_grade.grading_status IN ('GRADED', 'ADJUSTED')
    AND v_grade.release_status <> 'RELEASED' THEN
    UPDATE public.exam_grades
    SET
      release_status = 'RELEASED',
      released_by = v_uid,
      released_at_utc = v_now
    WHERE id = v_grade.id
    RETURNING * INTO v_grade;

    INSERT INTO public.attempt_events (
      school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
    ) VALUES (
      v_attempt.school_id, p_attempt_id, v_uid, 'server_confirmed', 'RESULTS_RELEASED',
      jsonb_build_object('releaseTrigger', 'after_manual_grading'), v_now
    );
  END IF;

  INSERT INTO public.attempt_events (
    school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
  ) VALUES (
    v_attempt.school_id, p_attempt_id, v_uid, 'server_confirmed', 'GRADE_FINALIZED',
    jsonb_build_object(
      'gradingStatus', v_grade.grading_status,
      'manualScore', v_grade.manual_score,
      'totalScore', v_grade.total_score,
      'pendingManualCount', v_grade.pending_manual_count
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'gradingStatus', v_grade.grading_status,
    'releaseStatus', v_grade.release_status,
    'objectiveScore', v_grade.objective_score,
    'manualScore', v_grade.manual_score,
    'adjustmentDelta', v_grade.adjustment_delta,
    'totalScore', v_grade.total_score,
    'maxScore', v_grade.max_score,
    'percentageScore', v_grade.percentage_score,
    'passed', v_grade.passed,
    'pendingManualCount', v_grade.pending_manual_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_exam_grade_atomic(
  p_attempt_id uuid,
  p_new_total_score numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_attempt public.exam_attempts%ROWTYPE;
  v_grade public.exam_grades%ROWTYPE;
  v_clean_reason text := btrim(COALESCE(p_reason, ''));
  v_clean_new numeric(10,2) := ROUND(p_new_total_score, 2);
  v_delta numeric(10,2);
  v_updated public.exam_grades%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.auth_teacher_can_grade_attempt(p_attempt_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_GRADE_ADJUSTMENT';
  END IF;

  IF char_length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'ADJUSTMENT_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.status NOT IN ('SUBMITTED', 'EXPIRED') THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FINALIZED';
  END IF;

  SELECT * INTO v_grade FROM public.exam_grades WHERE attempt_id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    v_grade := public._compute_and_upsert_exam_grade(p_attempt_id, v_uid, v_now);
  END IF;

  IF v_grade.pending_manual_count > 0 THEN
    RAISE EXCEPTION 'CANNOT_ADJUST_WHILE_ESSAY_PENDING';
  END IF;

  IF v_clean_new < 0 OR v_clean_new > v_grade.max_score THEN
    RAISE EXCEPTION 'ADJUSTED_SCORE_OUT_OF_RANGE';
  END IF;

  v_delta := ROUND(v_clean_new - v_grade.total_score, 2);

  INSERT INTO public.grade_adjustments (
    school_id,
    exam_grade_id,
    attempt_id,
    previous_total_score,
    new_total_score,
    adjustment_delta,
    reason,
    adjusted_by,
    created_at_utc
  ) VALUES (
    v_attempt.school_id,
    v_grade.id,
    p_attempt_id,
    v_grade.total_score,
    v_clean_new,
    v_delta,
    v_clean_reason,
    v_uid,
    v_now
  );

  v_updated := public._compute_and_upsert_exam_grade(p_attempt_id, v_uid, v_now);

  INSERT INTO public.attempt_events (
    school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
  ) VALUES (
    v_attempt.school_id, p_attempt_id, v_uid, 'server_confirmed', 'GRADE_ADJUSTED',
    jsonb_build_object(
      'previousTotalScore', v_grade.total_score,
      'newTotalScore', v_updated.total_score,
      'delta', v_delta,
      'reason', v_clean_reason
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'attemptId', p_attempt_id,
    'gradingStatus', v_updated.grading_status,
    'previousTotalScore', v_grade.total_score,
    'totalScore', v_updated.total_score,
    'percentageScore', v_updated.percentage_score,
    'passed', v_updated.passed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_exam_results_atomic(
  p_exam_id uuid,
  p_action text,
  p_allow_student_review boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_exam public.exams%ROWTYPE;
  v_updated_count integer := 0;
  v_pending_count integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.auth_can_manage_exam(p_exam_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_RESULTS_RELEASE';
  END IF;

  IF p_action NOT IN ('release', 'unpublish') THEN
    RAISE EXCEPTION 'INVALID_RELEASE_ACTION';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = p_exam_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  IF p_action = 'release' THEN
    UPDATE public.exams
    SET
      results_released_at = v_now,
      results_released_by = v_uid,
      allow_student_review = COALESCE(p_allow_student_review, allow_student_review)
    WHERE id = p_exam_id;

    UPDATE public.exam_grades
    SET
      release_status = 'RELEASED',
      released_by = v_uid,
      released_at_utc = v_now
    WHERE exam_id = p_exam_id
      AND grading_status IN ('GRADED', 'ADJUSTED')
      AND release_status <> 'RELEASED';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    SELECT COUNT(*) INTO v_pending_count
    FROM public.exam_grades
    WHERE exam_id = p_exam_id AND grading_status IN ('PENDING_OBJECTIVE', 'PENDING_MANUAL_REVIEW');

    INSERT INTO public.attempt_events (
      school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
    )
    SELECT
      eg.school_id, eg.attempt_id, v_uid, 'server_confirmed', 'RESULTS_RELEASED',
      jsonb_build_object('action', 'release'), v_now
    FROM public.exam_grades eg
    WHERE eg.exam_id = p_exam_id AND eg.release_status = 'RELEASED' AND eg.released_at_utc = v_now;

    RETURN jsonb_build_object(
      'examId', p_exam_id,
      'action', 'release',
      'releasedCount', v_updated_count,
      'pendingManualCount', v_pending_count,
      'resultsReleasedAt', v_now
    );
  ELSE
    UPDATE public.exams
    SET
      results_released_at = NULL,
      results_released_by = NULL,
      allow_student_review = COALESCE(p_allow_student_review, allow_student_review)
    WHERE id = p_exam_id;

    UPDATE public.exam_grades
    SET
      release_status = 'UNRELEASED',
      released_by = NULL,
      released_at_utc = NULL
    WHERE exam_id = p_exam_id AND release_status = 'RELEASED';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object(
      'examId', p_exam_id,
      'action', 'unpublish',
      'unpublishedCount', v_updated_count,
      'resultsReleasedAt', NULL
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_exam_attempt_by_admin(
  p_attempt_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_attempt public.exam_attempts%ROWTYPE;
  v_clean_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF char_length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_attempt FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_uid IS NULL OR NOT public.auth_is_school_admin(v_attempt.school_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_ADMIN_ONLY';
  END IF;

  IF v_attempt.status NOT IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTING') THEN
    RAISE EXCEPTION 'CANNOT_CANCEL_FINALIZED_ATTEMPT';
  END IF;

  UPDATE public.exam_attempts
  SET
    status = 'CANCELLED_BY_ADMIN',
    cancellation_reason = v_clean_reason,
    cancelled_by = v_uid,
    cancelled_at_utc = v_now,
    last_activity_at_utc = v_now
  WHERE id = p_attempt_id;

  INSERT INTO public.attempt_events (
    school_id, attempt_id, actor_user_id, event_source, event_type, metadata, created_at_utc
  ) VALUES (
    v_attempt.school_id, p_attempt_id, v_uid, 'server_confirmed', 'ATTEMPT_CANCELLED',
    jsonb_build_object('reason', v_clean_reason), v_now
  );

  RETURN jsonb_build_object(
    'attemptId', p_attempt_id,
    'status', 'CANCELLED_BY_ADMIN',
    'cancelledAtUtc', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_or_resume_exam_attempt(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_attempt_answer_atomic(uuid, uuid, uuid, integer, jsonb, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_attempt_question_flag(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_exam_attempt_atomic(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_expired_attempt_on_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_expired_exam_attempts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grade_essay_and_recalculate_atomic(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_exam_grade_atomic(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_exam_results_atomic(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_exam_attempt_by_admin(uuid, text) FROM PUBLIC;

-- Read-only helper returning only published question counts (zero stems/options/keys)
CREATE OR REPLACE FUNCTION public.get_student_published_question_counts(
  p_exam_version_ids uuid[]
)
RETURNS TABLE (exam_version_id uuid, question_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT evq.exam_version_id, COUNT(*)::bigint AS question_count
  FROM public.exam_version_questions evq
  JOIN public.exam_versions ev ON ev.id = evq.exam_version_id
  WHERE evq.exam_version_id = ANY(COALESCE(p_exam_version_ids, '{}'::uuid[]))
    AND ev.school_id = public.auth_school_id()
    AND (
      public.auth_student_can_access_exam(ev.exam_id)
      OR public.auth_can_manage_exam(ev.exam_id)
    )
  GROUP BY evq.exam_version_id;
$$;

REVOKE ALL ON FUNCTION public.get_student_published_question_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_published_question_counts(uuid[]) TO authenticated;

GRANT EXECUTE ON FUNCTION public.start_or_resume_exam_attempt(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_attempt_answer_atomic(uuid, uuid, uuid, integer, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_attempt_question_flag(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt_atomic(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_attempt_on_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_expired_exam_attempts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.grade_essay_and_recalculate_atomic(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_exam_grade_atomic(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_exam_results_atomic(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_exam_attempt_by_admin(uuid, text) TO authenticated;
