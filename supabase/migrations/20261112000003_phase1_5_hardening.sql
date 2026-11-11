-- ============================================================================
-- UjianKita Migration 000003: Cross-School Tenant Integrity Triggers
-- and Atomic Academic Year Activation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_same_school_classes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_year_school uuid;
  v_teacher_school uuid;
BEGIN
  SELECT school_id INTO v_year_school
  FROM public.academic_years
  WHERE id = NEW.academic_year_id;

  IF v_year_school IS NULL OR v_year_school <> NEW.school_id THEN
    RAISE EXCEPTION 'academic_year_id must belong to the same school';
  END IF;

  IF NEW.homeroom_teacher_id IS NOT NULL THEN
    SELECT school_id INTO v_teacher_school
    FROM public.teachers
    WHERE id = NEW.homeroom_teacher_id;

    IF v_teacher_school IS NULL OR v_teacher_school <> NEW.school_id THEN
      RAISE EXCEPTION 'homeroom_teacher_id must belong to the same school';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_same_school_classes ON public.classes;
CREATE TRIGGER trg_enforce_same_school_classes
  BEFORE INSERT OR UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_school_classes();

CREATE OR REPLACE FUNCTION public.enforce_same_school_enrollments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_class_school uuid;
  v_class_year uuid;
  v_student_school uuid;
BEGIN
  SELECT school_id, academic_year_id INTO v_class_school, v_class_year
  FROM public.classes
  WHERE id = NEW.class_id;

  SELECT school_id INTO v_student_school
  FROM public.students
  WHERE id = NEW.student_id;

  IF v_class_school IS NULL OR v_class_school <> NEW.school_id THEN
    RAISE EXCEPTION 'class_id must belong to the same school';
  END IF;

  IF v_class_year IS NULL OR v_class_year <> NEW.academic_year_id THEN
    RAISE EXCEPTION 'academic_year_id must match the class academic year';
  END IF;

  IF v_student_school IS NULL OR v_student_school <> NEW.school_id THEN
    RAISE EXCEPTION 'student_id must belong to the same school';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_same_school_enrollments ON public.class_enrollments;
CREATE TRIGGER trg_enforce_same_school_enrollments
  BEFORE INSERT OR UPDATE ON public.class_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_school_enrollments();

CREATE OR REPLACE FUNCTION public.enforce_same_school_teacher_assignments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_teacher_school uuid;
  v_class_school uuid;
  v_subject_school uuid;
  v_year_school uuid;
BEGIN
  SELECT school_id INTO v_teacher_school FROM public.teachers WHERE id = NEW.teacher_id;
  SELECT school_id INTO v_class_school FROM public.classes WHERE id = NEW.class_id;
  SELECT school_id INTO v_subject_school FROM public.subjects WHERE id = NEW.subject_id;
  SELECT school_id INTO v_year_school FROM public.academic_years WHERE id = NEW.academic_year_id;

  IF v_teacher_school IS DISTINCT FROM NEW.school_id
     OR v_class_school IS DISTINCT FROM NEW.school_id
     OR v_subject_school IS DISTINCT FROM NEW.school_id
     OR v_year_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'All teacher assignment references must belong to the same school';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_same_school_teacher_assignments ON public.teacher_assignments;
CREATE TRIGGER trg_enforce_same_school_teacher_assignments
  BEFORE INSERT OR UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_school_teacher_assignments();

CREATE OR REPLACE FUNCTION public.activate_academic_year(target_year_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_school_id uuid;
BEGIN
  SELECT school_id INTO v_school_id
  FROM public.academic_years
  WHERE id = target_year_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Academic year not found';
  END IF;

  IF NOT public.auth_is_school_admin(v_school_id) THEN
    RAISE EXCEPTION 'Forbidden: school administrator required';
  END IF;

  UPDATE public.academic_years
  SET is_active = false
  WHERE school_id = v_school_id
    AND is_active = true
    AND id <> target_year_id;

  UPDATE public.academic_years
  SET is_active = true
  WHERE id = target_year_id
    AND school_id = v_school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_academic_year(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_academic_year(uuid) TO authenticated;
