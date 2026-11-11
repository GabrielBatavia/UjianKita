-- ============================================================================
-- UjianKita Phase 1 Migration 000002: Row Level Security, Least Privilege
-- Policies, Immutability Triggers, and Authorization Helper Functions
-- ============================================================================

-- 1. Enforce append-only immutability on audit_events
CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; % operations are prohibited', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON public.audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- 2. Prevent non-service/non-admin callers from mutating protected user_profiles columns
CREATE OR REPLACE FUNCTION public.protect_user_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Service role (auth.uid() IS NULL in direct postgres/service calls) is allowed
  IF auth.uid() IS NOT NULL AND NOT public.auth_is_school_admin(OLD.school_id) THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      RAISE EXCEPTION 'Unauthorized modification of school_id';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Unauthorized modification of is_active';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Unauthorized modification of email';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Authorization Helper Functions (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.auth_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT up.school_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_has_role(target_role_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.user_roles ur ON ur.user_id = up.id AND ur.school_id = up.school_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE up.id = auth.uid()
      AND up.is_active = true
      AND r.code = target_role_code
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_school_admin(target_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.user_roles ur ON ur.user_id = up.id AND ur.school_id = up.school_id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE up.id = auth.uid()
      AND up.is_active = true
      AND up.school_id = target_school_id
      AND r.code = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_teacher_teaches_class(target_class_id uuid)
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
    WHERE t.user_id = auth.uid()
      AND t.is_active = true
      AND up.is_active = true
      AND (
        EXISTS (
          SELECT 1
          FROM public.teacher_assignments ta
          WHERE ta.teacher_id = t.id
            AND ta.class_id = target_class_id
            AND ta.is_active = true
        )
        OR EXISTS (
          SELECT 1
          FROM public.classes c
          WHERE c.id = target_class_id
            AND c.homeroom_teacher_id = t.id
            AND c.is_active = true
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_student_in_class(target_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.user_profiles up ON up.id = s.user_id
    JOIN public.class_enrollments ce ON ce.student_id = s.id
    WHERE s.user_id = auth.uid()
      AND s.is_active = true
      AND up.is_active = true
      AND ce.class_id = target_class_id
      AND ce.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_teacher_teaches_student(target_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_enrollments ce
    WHERE ce.student_id = target_student_id
      AND ce.status = 'active'
      AND public.auth_teacher_teaches_class(ce.class_id)
  );
$$;

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
        AND public.auth_teacher_teaches_student(s.id)
    );
$$;

REVOKE ALL ON FUNCTION public.auth_school_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_has_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_is_school_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_teacher_teaches_class(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_student_in_class(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_teacher_teaches_student(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_can_read_profile(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_school_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_teacher_teaches_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_student_in_class(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_teacher_teaches_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_read_profile(uuid, uuid) TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_user_profile_sensitive ON public.user_profiles;
CREATE TRIGGER trg_protect_user_profile_sensitive
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_profile_sensitive_columns();

-- 4. Enable Row Level Security on all tables
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- 5. Least-Privilege Policies

-- schools
CREATE POLICY "schools_select_own"
  ON public.schools FOR SELECT TO authenticated
  USING (id = public.auth_school_id());

CREATE POLICY "schools_update_admin"
  ON public.schools FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(id))
  WITH CHECK (public.auth_is_school_admin(id));

-- roles / permissions / role_permissions (read-only catalog for authenticated users)
CREATE POLICY "roles_select_authenticated"
  ON public.roles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "permissions_select_authenticated"
  ON public.permissions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "role_permissions_select_authenticated"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (true);

-- user_profiles
CREATE POLICY "user_profiles_select_scoped"
  ON public.user_profiles FOR SELECT TO authenticated
  USING (public.auth_can_read_profile(id, school_id));

CREATE POLICY "user_profiles_insert_admin"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "user_profiles_update_admin"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

-- user_roles
CREATE POLICY "user_roles_select_own_or_admin"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.auth_is_school_admin(school_id));

CREATE POLICY "user_roles_insert_admin"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "user_roles_delete_admin"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- academic_years
CREATE POLICY "academic_years_select_school"
  ON public.academic_years FOR SELECT TO authenticated
  USING (school_id = public.auth_school_id());

CREATE POLICY "academic_years_insert_admin"
  ON public.academic_years FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "academic_years_update_admin"
  ON public.academic_years FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "academic_years_delete_admin"
  ON public.academic_years FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- teachers (students cannot read teacher personal/NIP records directly)
CREATE POLICY "teachers_select_self_or_admin"
  ON public.teachers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.auth_is_school_admin(school_id));

CREATE POLICY "teachers_insert_admin"
  ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "teachers_update_admin"
  ON public.teachers FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "teachers_delete_admin"
  ON public.teachers FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- classes
CREATE POLICY "classes_select_authorized"
  ON public.classes FOR SELECT TO authenticated
  USING (
    public.auth_is_school_admin(school_id)
    OR public.auth_teacher_teaches_class(id)
    OR public.auth_student_in_class(id)
  );

CREATE POLICY "classes_insert_admin"
  ON public.classes FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "classes_update_admin"
  ON public.classes FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "classes_delete_admin"
  ON public.classes FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- subjects
CREATE POLICY "subjects_select_authorized"
  ON public.subjects FOR SELECT TO authenticated
  USING (
    public.auth_is_school_admin(school_id)
    OR (
      school_id = public.auth_school_id()
      AND (public.auth_has_role('teacher') OR public.auth_has_role('student'))
    )
  );

CREATE POLICY "subjects_insert_admin"
  ON public.subjects FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "subjects_update_admin"
  ON public.subjects FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "subjects_delete_admin"
  ON public.subjects FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- students (strict: student sees ONLY self; teacher sees ONLY enrolled students in assigned classes; admin sees school)
CREATE POLICY "students_select_authorized"
  ON public.students FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_school_admin(school_id)
    OR public.auth_teacher_teaches_student(id)
  );

CREATE POLICY "students_insert_admin"
  ON public.students FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "students_update_admin"
  ON public.students FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "students_delete_admin"
  ON public.students FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- class_enrollments
CREATE POLICY "class_enrollments_select_authorized"
  ON public.class_enrollments FOR SELECT TO authenticated
  USING (
    public.auth_is_school_admin(school_id)
    OR public.auth_teacher_teaches_class(class_id)
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = student_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "class_enrollments_insert_admin"
  ON public.class_enrollments FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "class_enrollments_update_admin"
  ON public.class_enrollments FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "class_enrollments_delete_admin"
  ON public.class_enrollments FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- teacher_assignments
CREATE POLICY "teacher_assignments_select_authorized"
  ON public.teacher_assignments FOR SELECT TO authenticated
  USING (
    public.auth_is_school_admin(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_id AND t.user_id = auth.uid()
    )
    OR public.auth_student_in_class(class_id)
  );

CREATE POLICY "teacher_assignments_insert_admin"
  ON public.teacher_assignments FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "teacher_assignments_update_admin"
  ON public.teacher_assignments FOR UPDATE TO authenticated
  USING (public.auth_is_school_admin(school_id))
  WITH CHECK (public.auth_is_school_admin(school_id));

CREATE POLICY "teacher_assignments_delete_admin"
  ON public.teacher_assignments FOR DELETE TO authenticated
  USING (public.auth_is_school_admin(school_id));

-- audit_events (append-only; admin-only SELECT; actor-bound INSERT)
CREATE POLICY "audit_events_select_admin"
  ON public.audit_events FOR SELECT TO authenticated
  USING (public.auth_is_school_admin(school_id));

CREATE POLICY "audit_events_insert_actor"
  ON public.audit_events FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.auth_school_id()
    AND actor_user_id = auth.uid()
  );
