-- ============================================================================
-- UjianKita Phase 2 Migration 000005: Immutability Triggers, Cross-School
-- Integrity Triggers, Least-Privilege RLS Policies, and Atomic RPCs
-- ============================================================================

-- 1. Immutability protection for versioned questions & published exam snapshots
CREATE OR REPLACE FUNCTION public.prevent_immutable_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is immutable; UPDATE is prohibited', TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' AND (auth.uid() IS NOT NULL OR pg_trigger_depth() = 0) THEN
    -- Disallow direct deletes by authenticated callers or direct deletes;
    -- only parent school teardown cascading by service role may clean up.
    RAISE EXCEPTION '% is immutable; DELETE is prohibited', TG_TABLE_NAME;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_question_versions_immutable ON public.question_versions;
CREATE TRIGGER trg_question_versions_immutable
  BEFORE UPDATE OR DELETE ON public.question_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_question_options_immutable ON public.question_options;
CREATE TRIGGER trg_question_options_immutable
  BEFORE UPDATE OR DELETE ON public.question_options
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_question_answer_keys_immutable ON public.question_answer_keys;
CREATE TRIGGER trg_question_answer_keys_immutable
  BEFORE UPDATE OR DELETE ON public.question_answer_keys
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_exam_versions_immutable ON public.exam_versions;
CREATE TRIGGER trg_exam_versions_immutable
  BEFORE UPDATE OR DELETE ON public.exam_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_exam_version_questions_immutable ON public.exam_version_questions;
CREATE TRIGGER trg_exam_version_questions_immutable
  BEFORE UPDATE OR DELETE ON public.exam_version_questions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_exam_version_answer_keys_immutable ON public.exam_version_answer_keys;
CREATE TRIGGER trg_exam_version_answer_keys_immutable
  BEFORE UPDATE OR DELETE ON public.exam_version_answer_keys
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_exam_publication_events_immutable ON public.exam_publication_events;
CREATE TRIGGER trg_exam_publication_events_immutable
  BEFORE UPDATE OR DELETE ON public.exam_publication_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_immutable_snapshot_mutation();

-- 2. Prevent editing draft questions while exam is PUBLISHED, CLOSED, or ARCHIVED
CREATE OR REPLACE FUNCTION public.guard_draft_exam_question_edits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_exam_id uuid;
  v_status text;
BEGIN
  v_exam_id := COALESCE(NEW.exam_id, OLD.exam_id);
  SELECT status INTO v_status FROM public.exams WHERE id = v_exam_id;

  IF v_status NOT IN ('DRAFT', 'READY_FOR_REVIEW') THEN
    RAISE EXCEPTION 'Cannot modify draft questions while exam status is %', v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_draft_exam_questions ON public.exam_draft_questions;
CREATE TRIGGER trg_guard_draft_exam_questions
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_draft_questions
  FOR EACH ROW EXECUTE FUNCTION public.guard_draft_exam_question_edits();

-- 3. Authorization helpers for Phase 2 teacher subject/exam ownership
CREATE OR REPLACE FUNCTION public.auth_teacher_teaches_subject(target_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers t
    JOIN public.user_profiles up ON up.id = t.user_id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE t.user_id = auth.uid()
      AND t.is_active = true
      AND up.is_active = true
      AND ta.subject_id = target_subject_id
      AND ta.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_access_subject_content(
  target_school_id uuid,
  target_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    public.auth_is_school_admin(target_school_id)
    OR (
      target_school_id = public.auth_school_id()
      AND public.auth_has_role('teacher')
      AND public.auth_teacher_teaches_subject(target_subject_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_can_manage_exam(target_exam_id uuid)
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
      AND public.auth_can_access_subject_content(e.school_id, e.subject_id)
  );
$$;

REVOKE ALL ON FUNCTION public.auth_teacher_teaches_subject(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_can_access_subject_content(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_can_manage_exam(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_teacher_teaches_subject(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_access_subject_content(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_manage_exam(uuid) TO authenticated;

-- 4. Enable RLS on all Phase 2 tables
ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_draft_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_version_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_version_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_publication_events ENABLE ROW LEVEL SECURITY;

-- 5. Least-Privilege RLS Policies (ZERO student access to Phase 2 bank/answer keys)

-- question_banks
CREATE POLICY "question_banks_select_authorized"
  ON public.question_banks FOR SELECT TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "question_banks_insert_authorized"
  ON public.question_banks FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "question_banks_update_authorized"
  ON public.question_banks FOR UPDATE TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id))
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

-- questions
CREATE POLICY "questions_select_authorized"
  ON public.questions FOR SELECT TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "questions_insert_authorized"
  ON public.questions FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "questions_update_authorized"
  ON public.questions FOR UPDATE TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id))
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

-- question_versions
CREATE POLICY "question_versions_select_authorized"
  ON public.question_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

CREATE POLICY "question_versions_insert_authorized"
  ON public.question_versions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.questions q
      WHERE q.id = question_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

-- question_options
CREATE POLICY "question_options_select_authorized"
  ON public.question_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.question_versions qv
      JOIN public.questions q ON q.id = qv.question_id
      WHERE qv.id = question_version_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

CREATE POLICY "question_options_insert_authorized"
  ON public.question_options FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.question_versions qv
      JOIN public.questions q ON q.id = qv.question_id
      WHERE qv.id = question_version_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

-- question_answer_keys (strictly staff-authorized only; zero student access)
CREATE POLICY "question_answer_keys_select_authorized"
  ON public.question_answer_keys FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.question_versions qv
      JOIN public.questions q ON q.id = qv.question_id
      WHERE qv.id = question_version_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

CREATE POLICY "question_answer_keys_insert_authorized"
  ON public.question_answer_keys FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.question_versions qv
      JOIN public.questions q ON q.id = qv.question_id
      WHERE qv.id = question_version_id
        AND public.auth_can_access_subject_content(q.school_id, q.subject_id)
    )
  );

-- import_batches
CREATE POLICY "import_batches_select_authorized"
  ON public.import_batches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = question_bank_id
        AND public.auth_can_access_subject_content(qb.school_id, qb.subject_id)
    )
  );

CREATE POLICY "import_batches_insert_authorized"
  ON public.import_batches FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = question_bank_id
        AND public.auth_can_access_subject_content(qb.school_id, qb.subject_id)
    )
  );

-- exams
CREATE POLICY "exams_select_authorized"
  ON public.exams FOR SELECT TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "exams_insert_authorized"
  ON public.exams FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "exams_update_authorized"
  ON public.exams FOR UPDATE TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id))
  WITH CHECK (public.auth_can_access_subject_content(school_id, subject_id));

-- exam_draft_questions
CREATE POLICY "exam_draft_questions_all_authorized"
  ON public.exam_draft_questions FOR ALL TO authenticated
  USING (public.auth_can_manage_exam(exam_id))
  WITH CHECK (public.auth_can_manage_exam(exam_id));

-- exam_assignments
CREATE POLICY "exam_assignments_all_authorized"
  ON public.exam_assignments FOR ALL TO authenticated
  USING (public.auth_can_manage_exam(exam_id))
  WITH CHECK (
    public.auth_can_manage_exam(exam_id)
    AND (
      public.auth_is_school_admin(school_id)
      OR public.auth_teacher_teaches_class(class_id)
    )
  );

-- exam_schedules
CREATE POLICY "exam_schedules_all_authorized"
  ON public.exam_schedules FOR ALL TO authenticated
  USING (public.auth_can_manage_exam(exam_id))
  WITH CHECK (
    public.auth_can_manage_exam(exam_id)
    AND (
      public.auth_is_school_admin(school_id)
      OR public.auth_teacher_teaches_class(class_id)
    )
  );

-- exam_versions / exam_version_questions / exam_version_answer_keys / exam_publication_events
CREATE POLICY "exam_versions_select_authorized"
  ON public.exam_versions FOR SELECT TO authenticated
  USING (public.auth_can_access_subject_content(school_id, subject_id));

CREATE POLICY "exam_version_questions_select_authorized"
  ON public.exam_version_questions FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam((SELECT exam_id FROM public.exam_versions ev WHERE ev.id = exam_version_id)));

CREATE POLICY "exam_version_answer_keys_select_authorized"
  ON public.exam_version_answer_keys FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.exam_version_questions evq
      JOIN public.exam_versions ev ON ev.id = evq.exam_version_id
      WHERE evq.id = exam_version_question_id
        AND public.auth_can_access_subject_content(ev.school_id, ev.subject_id)
    )
  );

CREATE POLICY "exam_publication_events_select_authorized"
  ON public.exam_publication_events FOR SELECT TO authenticated
  USING (public.auth_can_manage_exam(exam_id));

-- 6. Atomic Transactional Question Creation RPC
CREATE OR REPLACE FUNCTION public.create_question_with_version(
  p_question_bank_id uuid,
  p_subject_id uuid,
  p_question_type text,
  p_difficulty text,
  p_topic text,
  p_tags text[],
  p_status text,
  p_attachment_metadata jsonb,
  p_content_fingerprint text,
  p_stem text,
  p_explanation text,
  p_points numeric,
  p_scoring_policy text,
  p_rubric_notes text,
  p_preserve_option_order boolean,
  p_options jsonb,
  p_correct_option_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_school_id uuid;
  v_bank_school uuid;
  v_bank_subject uuid;
  v_question_id uuid;
  v_version_id uuid;
  v_opt jsonb;
  v_idx integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_school_id := public.auth_school_id();
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Forbidden: active school profile required';
  END IF;

  IF NOT public.auth_can_access_subject_content(v_school_id, p_subject_id) THEN
    RAISE EXCEPTION 'Forbidden: not authorized for subject';
  END IF;

  SELECT school_id, subject_id INTO v_bank_school, v_bank_subject
  FROM public.question_banks
  WHERE id = p_question_bank_id;

  IF v_bank_school IS DISTINCT FROM v_school_id OR v_bank_subject IS DISTINCT FROM p_subject_id THEN
    RAISE EXCEPTION 'Question bank does not match school or subject';
  END IF;

  INSERT INTO public.questions (
    school_id,
    question_bank_id,
    subject_id,
    created_by,
    question_type,
    difficulty,
    topic,
    tags,
    status,
    attachment_metadata,
    content_fingerprint
  )
  VALUES (
    v_school_id,
    p_question_bank_id,
    p_subject_id,
    v_user_id,
    p_question_type,
    p_difficulty,
    p_topic,
    COALESCE(p_tags, '{}'::text[]),
    p_status,
    COALESCE(p_attachment_metadata, '[]'::jsonb),
    p_content_fingerprint
  )
  RETURNING id INTO v_question_id;

  INSERT INTO public.question_versions (
    school_id,
    question_id,
    version_number,
    stem,
    explanation,
    points,
    scoring_policy,
    rubric_notes,
    preserve_option_order,
    created_by
  )
  VALUES (
    v_school_id,
    v_question_id,
    1,
    p_stem,
    p_explanation,
    p_points,
    p_scoring_policy,
    p_rubric_notes,
    COALESCE(p_preserve_option_order, false),
    v_user_id
  )
  RETURNING id INTO v_version_id;

  IF p_question_type <> 'essay' AND p_options IS NOT NULL THEN
    FOR v_opt IN SELECT * FROM jsonb_array_elements(p_options)
    LOOP
      INSERT INTO public.question_options (
        school_id,
        question_version_id,
        option_key,
        option_text,
        display_order
      )
      VALUES (
        v_school_id,
        v_version_id,
        trim(v_opt->>'optionKey'),
        trim(v_opt->>'optionText'),
        COALESCE((v_opt->>'displayOrder')::integer, v_idx)
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  INSERT INTO public.question_answer_keys (
    school_id,
    question_version_id,
    correct_option_keys,
    scoring_metadata
  )
  VALUES (
    v_school_id,
    v_version_id,
    COALESCE(p_correct_option_keys, '{}'::text[]),
    jsonb_build_object('question_type', p_question_type, 'scoring_policy', p_scoring_policy)
  );

  UPDATE public.questions
  SET current_version_id = v_version_id
  WHERE id = v_question_id;

  INSERT INTO public.audit_events (
    school_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    v_school_id,
    v_user_id,
    CASE WHEN public.auth_is_school_admin(v_school_id) THEN 'admin' ELSE 'teacher' END,
    'question.created',
    'question',
    v_question_id::text,
    'Membuat soal baru pada bank soal (v1)',
    jsonb_build_object('question_type', p_question_type, 'subject_id', p_subject_id)
  );

  RETURN jsonb_build_object(
    'question_id', v_question_id,
    'version_id', v_version_id,
    'version_number', 1
  );
END;
$$;

-- 7. Atomic New-Version Question Update RPC (never overwrites published history)
CREATE OR REPLACE FUNCTION public.update_question_new_version(
  p_question_id uuid,
  p_difficulty text,
  p_topic text,
  p_tags text[],
  p_status text,
  p_attachment_metadata jsonb,
  p_content_fingerprint text,
  p_stem text,
  p_explanation text,
  p_points numeric,
  p_scoring_policy text,
  p_rubric_notes text,
  p_preserve_option_order boolean,
  p_options jsonb,
  p_correct_option_keys text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_question public.questions%ROWTYPE;
  v_next_ver integer;
  v_version_id uuid;
  v_opt jsonb;
  v_idx integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_question
  FROM public.questions
  WHERE id = p_question_id
  FOR UPDATE;

  IF v_question.id IS NULL THEN
    RAISE EXCEPTION 'Question not found';
  END IF;

  IF NOT public.auth_can_access_subject_content(v_question.school_id, v_question.subject_id) THEN
    RAISE EXCEPTION 'Forbidden: not authorized for question';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_ver
  FROM public.question_versions
  WHERE question_id = p_question_id;

  INSERT INTO public.question_versions (
    school_id,
    question_id,
    version_number,
    stem,
    explanation,
    points,
    scoring_policy,
    rubric_notes,
    preserve_option_order,
    created_by
  )
  VALUES (
    v_question.school_id,
    p_question_id,
    v_next_ver,
    p_stem,
    p_explanation,
    p_points,
    p_scoring_policy,
    p_rubric_notes,
    COALESCE(p_preserve_option_order, false),
    v_user_id
  )
  RETURNING id INTO v_version_id;

  IF v_question.question_type <> 'essay' AND p_options IS NOT NULL THEN
    FOR v_opt IN SELECT * FROM jsonb_array_elements(p_options)
    LOOP
      INSERT INTO public.question_options (
        school_id,
        question_version_id,
        option_key,
        option_text,
        display_order
      )
      VALUES (
        v_question.school_id,
        v_version_id,
        trim(v_opt->>'optionKey'),
        trim(v_opt->>'optionText'),
        COALESCE((v_opt->>'displayOrder')::integer, v_idx)
      );
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  INSERT INTO public.question_answer_keys (
    school_id,
    question_version_id,
    correct_option_keys,
    scoring_metadata
  )
  VALUES (
    v_question.school_id,
    v_version_id,
    COALESCE(p_correct_option_keys, '{}'::text[]),
    jsonb_build_object('question_type', v_question.question_type, 'scoring_policy', p_scoring_policy)
  );

  UPDATE public.questions
  SET
    difficulty = p_difficulty,
    topic = p_topic,
    tags = COALESCE(p_tags, '{}'::text[]),
    status = p_status,
    attachment_metadata = COALESCE(p_attachment_metadata, '[]'::jsonb),
    content_fingerprint = p_content_fingerprint,
    current_version_id = v_version_id
  WHERE id = p_question_id;

  INSERT INTO public.audit_events (
    school_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    v_question.school_id,
    v_user_id,
    CASE WHEN public.auth_is_school_admin(v_question.school_id) THEN 'admin' ELSE 'teacher' END,
    'question.version_created',
    'question',
    p_question_id::text,
    format('Memperbarui soal ke versi v%s', v_next_ver),
    jsonb_build_object('version_number', v_next_ver, 'version_id', v_version_id)
  );

  RETURN jsonb_build_object(
    'question_id', p_question_id,
    'version_id', v_version_id,
    'version_number', v_next_ver
  );
END;
$$;

-- 8. Atomic Bulk Import RPC
CREATE OR REPLACE FUNCTION public.import_questions_atomic(
  p_question_bank_id uuid,
  p_file_name text,
  p_file_format text,
  p_total_rows integer,
  p_rejected_count integer,
  p_rows jsonb,
  p_report_summary jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_school_id uuid;
  v_subject_id uuid;
  v_row jsonb;
  v_created jsonb;
  v_imported_ids uuid[] := '{}'::uuid[];
  v_batch_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT school_id, subject_id INTO v_school_id, v_subject_id
  FROM public.question_banks
  WHERE id = p_question_bank_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Question bank not found';
  END IF;

  IF NOT public.auth_can_access_subject_content(v_school_id, v_subject_id) THEN
    RAISE EXCEPTION 'Forbidden: not authorized for bank';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_created := public.create_question_with_version(
      p_question_bank_id,
      v_subject_id,
      v_row->>'questionType',
      v_row->>'difficulty',
      NULLIF(v_row->>'topic', ''),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row->'tags', '[]'::jsonb))),
      COALESCE(v_row->>'status', 'active'),
      '[]'::jsonb,
      v_row->>'fingerprint',
      v_row->>'stem',
      NULLIF(v_row->>'explanation', ''),
      (v_row->>'points')::numeric,
      v_row->>'scoringPolicy',
      NULLIF(v_row->>'rubricNotes', ''),
      COALESCE((v_row->>'preserveOptionOrder')::boolean, false),
      v_row->'options',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row->'correctOptionKeys', '[]'::jsonb)))
    );
    v_imported_ids := array_append(v_imported_ids, (v_created->>'question_id')::uuid);
  END LOOP;

  INSERT INTO public.import_batches (
    school_id,
    question_bank_id,
    uploaded_by,
    file_name,
    file_format,
    total_rows,
    imported_count,
    rejected_count,
    report_summary
  )
  VALUES (
    v_school_id,
    p_question_bank_id,
    v_user_id,
    p_file_name,
    p_file_format,
    p_total_rows,
    COALESCE(array_length(v_imported_ids, 1), 0),
    p_rejected_count,
    COALESCE(p_report_summary, '{}'::jsonb)
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.audit_events (
    school_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    v_school_id,
    v_user_id,
    CASE WHEN public.auth_is_school_admin(v_school_id) THEN 'admin' ELSE 'teacher' END,
    'question.bulk_imported',
    'import_batch',
    v_batch_id::text,
    format('Impor massal %s soal dari berkas %s', COALESCE(array_length(v_imported_ids, 1), 0), p_file_name),
    jsonb_build_object(
      'batch_id', v_batch_id,
      'imported_count', COALESCE(array_length(v_imported_ids, 1), 0),
      'rejected_count', p_rejected_count
    )
  );

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'imported_count', COALESCE(array_length(v_imported_ids, 1), 0),
    'question_ids', to_jsonb(v_imported_ids)
  );
END;
$$;

-- 9. Atomic Exam Publication RPC (Locks exam, validates completeness, creates immutable snapshot)
CREATE OR REPLACE FUNCTION public.publish_exam_atomic(
  p_exam_id uuid,
  p_expected_version_lock integer,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_exam public.exams%ROWTYPE;
  v_next_version integer;
  v_version_id uuid;
  v_total_points numeric(10,2) := 0;
  v_question_count integer := 0;
  v_assigned_count integer := 0;
  v_draft_rec record;
  v_options_json jsonb;
  v_correct_keys text[];
  v_ev_q_id uuid;
  v_snapshot_hash text;
  v_eff_points numeric(8,2);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id = p_exam_id
  FOR UPDATE;

  IF v_exam.id IS NULL THEN
    RAISE EXCEPTION 'Exam not found';
  END IF;

  IF NOT public.auth_can_access_subject_content(v_exam.school_id, v_exam.subject_id) THEN
    RAISE EXCEPTION 'Forbidden: not authorized to publish this exam';
  END IF;

  IF v_exam.version_lock <> p_expected_version_lock THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Data ujian telah diubah oleh sesi lain. Muat ulang sebelum menerbitkan.';
  END IF;

  IF v_exam.status NOT IN ('DRAFT', 'READY_FOR_REVIEW') THEN
    RAISE EXCEPTION 'ALREADY_PUBLISHED: Ujian berstatus % dan tidak dapat diterbitkan ulang tanpa revisi.', v_exam.status;
  END IF;

  IF v_exam.starts_at IS NULL OR v_exam.ends_at IS NULL OR v_exam.ends_at <= v_exam.starts_at THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Waktu mulai dan selesai ujian harus valid.';
  END IF;

  SELECT COUNT(*) INTO v_assigned_count
  FROM public.exam_assignments
  WHERE exam_id = p_exam_id;

  IF v_assigned_count < 1 THEN
    RAISE EXCEPTION 'NO_ASSIGNED_CLASSES: Minimal satu kelas peserta harus ditetapkan sebelum publikasi.';
  END IF;

  -- Ensure all assigned classes belong to authorized classes if teacher
  IF NOT public.auth_is_school_admin(v_exam.school_id) THEN
    IF EXISTS (
      SELECT 1 FROM public.exam_assignments ea
      WHERE ea.exam_id = p_exam_id
        AND NOT public.auth_teacher_teaches_class(ea.class_id)
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN_CLASS_ASSIGNMENT: Terdapat kelas di luar penugasan Anda.';
    END IF;
  END IF;

  -- Validate draft questions and compute total points
  FOR v_draft_rec IN
    SELECT
      edq.display_order,
      edq.points_override,
      edq.preserve_order,
      q.id AS question_id,
      q.status AS question_status,
      q.question_type,
      q.difficulty,
      qv.id AS version_id,
      qv.stem,
      qv.explanation,
      qv.points,
      qv.scoring_policy,
      qv.rubric_notes,
      qv.preserve_option_order
    FROM public.exam_draft_questions edq
    JOIN public.questions q ON q.id = edq.question_id
    JOIN public.question_versions qv ON qv.id = q.current_version_id
    WHERE edq.exam_id = p_exam_id
    ORDER BY edq.display_order ASC
  LOOP
    IF v_draft_rec.question_status = 'archived' THEN
      RAISE EXCEPTION 'ARCHIVED_QUESTION: Soal yang diarsipkan tidak boleh diterbitkan dalam ujian.';
    END IF;

    IF v_draft_rec.question_type <> 'essay' THEN
      SELECT COALESCE(array_length(correct_option_keys, 1), 0) INTO v_assigned_count
      FROM public.question_answer_keys
      WHERE question_version_id = v_draft_rec.version_id;

      IF COALESCE(v_assigned_count, 0) < 1 THEN
        RAISE EXCEPTION 'MISSING_ANSWER_KEY: Soal non-esai belum memiliki kunci jawaban valid.';
      END IF;
    END IF;

    v_eff_points := COALESCE(v_draft_rec.points_override, v_draft_rec.points);
    v_total_points := v_total_points + v_eff_points;
    v_question_count := v_question_count + 1;
  END LOOP;

  IF v_question_count < 1 OR v_total_points <= 0 THEN
    RAISE EXCEPTION 'NO_QUESTIONS: Ujian harus memiliki minimal satu soal valid sebelum diterbitkan.';
  END IF;

  IF v_exam.passing_score > v_total_points THEN
    RAISE EXCEPTION 'INVALID_PASSING_SCORE: Nilai ketuntasan melebihi total poin ujian.';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.exam_versions
  WHERE exam_id = p_exam_id;

  v_snapshot_hash := encode(
    digest(
      format('%s:%s:%s:%s:%s', p_exam_id, v_next_version, v_question_count, v_total_points, timezone('utc', now())),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.exam_versions (
    school_id,
    exam_id,
    version_number,
    title,
    description,
    instructions,
    subject_id,
    academic_year_id,
    duration_minutes,
    max_attempts,
    total_points,
    passing_score,
    randomize_questions,
    randomize_options,
    starts_at,
    ends_at,
    snapshot_hash,
    published_by,
    is_frozen
  )
  VALUES (
    v_exam.school_id,
    p_exam_id,
    v_next_version,
    v_exam.title,
    v_exam.description,
    v_exam.instructions,
    v_exam.subject_id,
    v_exam.academic_year_id,
    v_exam.duration_minutes,
    v_exam.max_attempts,
    v_total_points,
    v_exam.passing_score,
    v_exam.randomize_questions,
    v_exam.randomize_options,
    v_exam.starts_at,
    v_exam.ends_at,
    v_snapshot_hash,
    v_user_id,
    true
  )
  RETURNING id INTO v_version_id;

  -- Freeze questions + options snapshot + separate answer keys
  FOR v_draft_rec IN
    SELECT
      edq.display_order,
      edq.points_override,
      edq.preserve_order,
      q.id AS question_id,
      q.question_type,
      q.difficulty,
      qv.id AS version_id,
      qv.stem,
      qv.explanation,
      qv.points,
      qv.scoring_policy,
      qv.rubric_notes,
      qv.preserve_option_order
    FROM public.exam_draft_questions edq
    JOIN public.questions q ON q.id = edq.question_id
    JOIN public.question_versions qv ON qv.id = q.current_version_id
    WHERE edq.exam_id = p_exam_id
    ORDER BY edq.display_order ASC
  LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'option_key', qo.option_key,
          'option_text', qo.option_text,
          'display_order', qo.display_order
        )
        ORDER BY qo.display_order ASC
      ),
      '[]'::jsonb
    )
    INTO v_options_json
    FROM public.question_options qo
    WHERE qo.question_version_id = v_draft_rec.version_id;

    SELECT COALESCE(correct_option_keys, '{}'::text[])
    INTO v_correct_keys
    FROM public.question_answer_keys
    WHERE question_version_id = v_draft_rec.version_id;

    v_eff_points := COALESCE(v_draft_rec.points_override, v_draft_rec.points);

    INSERT INTO public.exam_version_questions (
      school_id,
      exam_version_id,
      source_question_id,
      source_question_version_id,
      display_order,
      question_type,
      difficulty,
      stem,
      explanation,
      points,
      scoring_policy,
      rubric_notes,
      preserve_option_order,
      preserve_question_position,
      options_snapshot
    )
    VALUES (
      v_exam.school_id,
      v_version_id,
      v_draft_rec.question_id,
      v_draft_rec.version_id,
      v_draft_rec.display_order,
      v_draft_rec.question_type,
      v_draft_rec.difficulty,
      v_draft_rec.stem,
      v_draft_rec.explanation,
      v_eff_points,
      v_draft_rec.scoring_policy,
      v_draft_rec.rubric_notes,
      v_draft_rec.preserve_option_order,
      v_draft_rec.preserve_order,
      v_options_json
    )
    RETURNING id INTO v_ev_q_id;

    INSERT INTO public.exam_version_answer_keys (
      school_id,
      exam_version_question_id,
      correct_option_keys,
      scoring_metadata
    )
    VALUES (
      v_exam.school_id,
      v_ev_q_id,
      COALESCE(v_correct_keys, '{}'::text[]),
      jsonb_build_object(
        'points', v_eff_points,
        'question_type', v_draft_rec.question_type,
        'scoring_policy', v_draft_rec.scoring_policy
      )
    );
  END LOOP;

  -- Synchronize exam_schedules for all assigned classes
  INSERT INTO public.exam_schedules (
    school_id,
    exam_id,
    class_id,
    starts_at,
    ends_at,
    duration_minutes,
    max_attempts
  )
  SELECT
    v_exam.school_id,
    p_exam_id,
    ea.class_id,
    v_exam.starts_at,
    v_exam.ends_at,
    v_exam.duration_minutes,
    v_exam.max_attempts
  FROM public.exam_assignments ea
  WHERE ea.exam_id = p_exam_id
  ON CONFLICT (exam_id, class_id) DO UPDATE
  SET
    starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at,
    duration_minutes = EXCLUDED.duration_minutes,
    max_attempts = EXCLUDED.max_attempts;

  UPDATE public.exams
  SET
    status = 'PUBLISHED',
    published_version_id = v_version_id,
    version_lock = version_lock + 1
  WHERE id = p_exam_id;

  INSERT INTO public.exam_publication_events (
    school_id,
    exam_id,
    exam_version_id,
    event_type,
    actor_user_id,
    notes,
    metadata
  )
  VALUES (
    v_exam.school_id,
    p_exam_id,
    v_version_id,
    'PUBLISHED',
    v_user_id,
    p_notes,
    jsonb_build_object(
      'version_number', v_next_version,
      'question_count', v_question_count,
      'total_points', v_total_points,
      'snapshot_hash', v_snapshot_hash
    )
  );

  INSERT INTO public.audit_events (
    school_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    v_exam.school_id,
    v_user_id,
    CASE WHEN public.auth_is_school_admin(v_exam.school_id) THEN 'admin' ELSE 'teacher' END,
    'exam.published',
    'exam',
    p_exam_id::text,
    format('Menerbitkan ujian "%s" versi v%s (%s soal)', v_exam.title, v_next_version, v_question_count),
    jsonb_build_object(
      'exam_version_id', v_version_id,
      'version_number', v_next_version,
      'snapshot_hash', v_snapshot_hash
    )
  );

  RETURN jsonb_build_object(
    'exam_version_id', v_version_id,
    'version_number', v_next_version,
    'total_points', v_total_points,
    'question_count', v_question_count,
    'snapshot_hash', v_snapshot_hash,
    'version_lock', v_exam.version_lock + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_question_with_version(uuid, uuid, text, text, text, text[], text, jsonb, text, text, text, numeric, text, text, boolean, jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_question_new_version(uuid, text, text, text[], text, jsonb, text, text, text, numeric, text, text, boolean, jsonb, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_questions_atomic(uuid, text, text, integer, integer, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_exam_atomic(uuid, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_question_with_version(uuid, uuid, text, text, text, text[], text, jsonb, text, text, text, numeric, text, text, boolean, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_question_new_version(uuid, text, text, text[], text, jsonb, text, text, text, numeric, text, text, boolean, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_questions_atomic(uuid, text, text, integer, integer, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_exam_atomic(uuid, integer, text) TO authenticated;

-- 10. Explicit Exam Revision Workflow (PUBLISHED -> DRAFT while preserving frozen snapshots)
CREATE OR REPLACE FUNCTION public.start_exam_revision(
  p_exam_id uuid,
  p_expected_version_lock integer,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_exam public.exams%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_exam
  FROM public.exams
  WHERE id = p_exam_id
  FOR UPDATE;

  IF v_exam.id IS NULL THEN
    RAISE EXCEPTION 'Exam not found';
  END IF;

  IF NOT public.auth_can_access_subject_content(v_exam.school_id, v_exam.subject_id) THEN
    RAISE EXCEPTION 'Forbidden: not authorized for exam';
  END IF;

  IF v_exam.version_lock <> p_expected_version_lock THEN
    RAISE EXCEPTION 'CONCURRENCY_CONFLICT: Data ujian telah diubah oleh sesi lain.';
  END IF;

  IF v_exam.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: Hanya ujian berstatus PUBLISHED yang dapat dibuka untuk revisi baru.';
  END IF;

  UPDATE public.exams
  SET
    status = 'DRAFT',
    version_lock = version_lock + 1
  WHERE id = p_exam_id;

  INSERT INTO public.exam_publication_events (
    school_id,
    exam_id,
    exam_version_id,
    event_type,
    actor_user_id,
    notes,
    metadata
  )
  VALUES (
    v_exam.school_id,
    p_exam_id,
    v_exam.published_version_id,
    'REVISION_STARTED',
    v_user_id,
    p_notes,
    jsonb_build_object('preserved_version_id', v_exam.published_version_id)
  );

  INSERT INTO public.audit_events (
    school_id,
    actor_user_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    summary,
    metadata
  )
  VALUES (
    v_exam.school_id,
    v_user_id,
    CASE WHEN public.auth_is_school_admin(v_exam.school_id) THEN 'admin' ELSE 'teacher' END,
    'exam.revision_started',
    'exam',
    p_exam_id::text,
    format('Membuka revisi draf baru untuk ujian "%s" (versi terpublikasi sebelumnya tetap tersimpan)', v_exam.title),
    jsonb_build_object('preserved_version_id', v_exam.published_version_id)
  );

  RETURN jsonb_build_object('status', 'DRAFT', 'version_lock', v_exam.version_lock + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.start_exam_revision(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_exam_revision(uuid, integer, text) TO authenticated;
