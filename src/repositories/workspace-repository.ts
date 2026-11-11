import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type { EmploymentStatus } from "@/domain/academic/types";

export interface TeacherWorkspaceClass {
  id: string;
  name: string;
  grade_level: string;
  program: string | null;
  academic_year_name: string;
  semester: string;
  is_homeroom: boolean;
  student_count: number;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    curriculum_group: string;
  }>;
}

export interface TeacherWorkspaceSubject {
  id: string;
  code: string;
  name: string;
  curriculum_group: string;
  description: string | null;
  classes: Array<{ id: string; name: string; grade_level: string }>;
}

export interface TeacherWorkspaceData {
  teacher: {
    id: string;
    nip: string | null;
    specialization: string | null;
    employment_status: EmploymentStatus;
    is_active: boolean;
  } | null;
  assignedClasses: TeacherWorkspaceClass[];
  assignedSubjects: TeacherWorkspaceSubject[];
}

export interface StudentPortalData {
  student: {
    id: string;
    nis: string;
    nisn: string | null;
    gender: "L" | "P" | null;
    guardian_name: string | null;
    guardian_phone: string | null;
    is_active: boolean;
  } | null;
  activeClass: {
    id: string;
    name: string;
    grade_level: string;
    program: string | null;
    academic_year_name: string;
    semester: string;
  } | null;
  subjects: Array<{
    id: string;
    code: string;
    name: string;
    curriculum_group: string;
  }>;
}

export async function fetchTeacherWorkspaceData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<TeacherWorkspaceData> {
  const { data: teacherRow, error: teacherError } = await supabase
    .from("teachers")
    .select("id, nip, specialization, employment_status, is_active")
    .eq("user_id", actor.userId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (teacherError) {
    throw new Error(`Gagal memuat profil guru: ${teacherError.message}`);
  }

  if (!teacherRow) {
    return { teacher: null, assignedClasses: [], assignedSubjects: [] };
  }

  const [assignmentsRes, homeroomRes] = await Promise.all([
    supabase
      .from("teacher_assignments")
      .select(
        `
        id,
        is_active,
        class:class_id (
          id,
          name,
          grade_level,
          program,
          homeroom_teacher_id,
          academic_year:academic_year_id ( name, semester ),
          enrollments:class_enrollments ( id, status )
        ),
        subject:subject_id (
          id,
          code,
          name,
          curriculum_group,
          description
        )
      `
      )
      .eq("teacher_id", teacherRow.id)
      .eq("is_active", true),
    supabase
      .from("classes")
      .select(
        `
        id,
        name,
        grade_level,
        program,
        academic_year:academic_year_id ( name, semester ),
        enrollments:class_enrollments ( id, status )
      `
      )
      .eq("homeroom_teacher_id", teacherRow.id)
      .eq("is_active", true),
  ]);

  if (assignmentsRes.error) {
    throw new Error(`Gagal memuat penugasan guru: ${assignmentsRes.error.message}`);
  }
  if (homeroomRes.error) {
    throw new Error(`Gagal memuat data wali kelas: ${homeroomRes.error.message}`);
  }

  const classMap = new Map<string, TeacherWorkspaceClass>();
  const subjectMap = new Map<string, TeacherWorkspaceSubject>();

  for (const hr of homeroomRes.data ?? []) {
    const yearRel = Array.isArray(hr.academic_year) ? hr.academic_year[0] : hr.academic_year;
    const enrollments = Array.isArray(hr.enrollments) ? hr.enrollments : [];
    const activeStudents = enrollments.filter(
      (e) => (e as { status?: string }).status === "active"
    ).length;

    classMap.set(hr.id as string, {
      id: hr.id as string,
      name: hr.name as string,
      grade_level: hr.grade_level as string,
      program: (hr.program as string | null) ?? null,
      academic_year_name: (yearRel as { name?: string } | null)?.name ?? "-",
      semester: (yearRel as { semester?: string } | null)?.semester ?? "-",
      is_homeroom: true,
      student_count: activeStudents,
      subjects: [],
    });
  }

  for (const row of assignmentsRes.data ?? []) {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    const subj = Array.isArray(row.subject) ? row.subject[0] : row.subject;
    if (!cls || !subj) continue;

    const clsObj = cls as {
      id: string;
      name: string;
      grade_level: string;
      program: string | null;
      homeroom_teacher_id: string | null;
      academic_year?: { name?: string; semester?: string } | Array<{ name?: string; semester?: string }> | null;
      enrollments?: Array<{ status?: string }> | null;
    };
    const subjObj = subj as {
      id: string;
      code: string;
      name: string;
      curriculum_group: string;
      description: string | null;
    };

    const yearRel = Array.isArray(clsObj.academic_year)
      ? clsObj.academic_year[0]
      : clsObj.academic_year;
    const activeStudents = (clsObj.enrollments ?? []).filter((e) => e.status === "active").length;

    const existingClass = classMap.get(clsObj.id) ?? {
      id: clsObj.id,
      name: clsObj.name,
      grade_level: clsObj.grade_level,
      program: clsObj.program ?? null,
      academic_year_name: yearRel?.name ?? "-",
      semester: yearRel?.semester ?? "-",
      is_homeroom: clsObj.homeroom_teacher_id === teacherRow.id,
      student_count: activeStudents,
      subjects: [],
    };

    if (!existingClass.subjects.some((s) => s.id === subjObj.id)) {
      existingClass.subjects.push({
        id: subjObj.id,
        code: subjObj.code,
        name: subjObj.name,
        curriculum_group: subjObj.curriculum_group,
      });
    }
    classMap.set(clsObj.id, existingClass);

    const existingSubject = subjectMap.get(subjObj.id) ?? {
      id: subjObj.id,
      code: subjObj.code,
      name: subjObj.name,
      curriculum_group: subjObj.curriculum_group,
      description: subjObj.description ?? null,
      classes: [],
    };

    if (!existingSubject.classes.some((c) => c.id === clsObj.id)) {
      existingSubject.classes.push({
        id: clsObj.id,
        name: clsObj.name,
        grade_level: clsObj.grade_level,
      });
    }
    subjectMap.set(subjObj.id, existingSubject);
  }

  return {
    teacher: {
      id: teacherRow.id as string,
      nip: (teacherRow.nip as string | null) ?? null,
      specialization: (teacherRow.specialization as string | null) ?? null,
      employment_status: teacherRow.employment_status as EmploymentStatus,
      is_active: Boolean(teacherRow.is_active),
    },
    assignedClasses: Array.from(classMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    assignedSubjects: Array.from(subjectMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export async function fetchStudentPortalData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<StudentPortalData> {
  const { data: studentRow, error: studentError } = await supabase
    .from("students")
    .select("id, nis, nisn, gender, guardian_name, guardian_phone, is_active")
    .eq("user_id", actor.userId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (studentError) {
    throw new Error(`Gagal memuat data siswa: ${studentError.message}`);
  }

  if (!studentRow) {
    return { student: null, activeClass: null, subjects: [] };
  }

  const { data: enrollment, error: enrollmentError } = await supabase
    .from("class_enrollments")
    .select(
      `
      id,
      status,
      class:class_id (
        id,
        name,
        grade_level,
        program,
        academic_year:academic_year_id ( name, semester )
      )
    `
    )
    .eq("student_id", studentRow.id)
    .eq("status", "active")
    .maybeSingle();

  if (enrollmentError) {
    throw new Error(`Gagal memuat kelas siswa: ${enrollmentError.message}`);
  }

  const clsRel = enrollment
    ? Array.isArray(enrollment.class)
      ? enrollment.class[0]
      : enrollment.class
    : null;

  if (!clsRel) {
    return {
      student: {
        id: studentRow.id as string,
        nis: studentRow.nis as string,
        nisn: (studentRow.nisn as string | null) ?? null,
        gender: (studentRow.gender as "L" | "P" | null) ?? null,
        guardian_name: (studentRow.guardian_name as string | null) ?? null,
        guardian_phone: (studentRow.guardian_phone as string | null) ?? null,
        is_active: Boolean(studentRow.is_active),
      },
      activeClass: null,
      subjects: [],
    };
  }

  const clsObj = clsRel as {
    id: string;
    name: string;
    grade_level: string;
    program: string | null;
    academic_year?: { name?: string; semester?: string } | Array<{ name?: string; semester?: string }> | null;
  };
  const yearRel = Array.isArray(clsObj.academic_year)
    ? clsObj.academic_year[0]
    : clsObj.academic_year;

  const { data: assignmentRows, error: assignError } = await supabase
    .from("teacher_assignments")
    .select("subject:subject_id ( id, code, name, curriculum_group )")
    .eq("class_id", clsObj.id)
    .eq("is_active", true);

  if (assignError) {
    throw new Error(`Gagal memuat mata pelajaran kelas: ${assignError.message}`);
  }

  const subjectMap = new Map<
    string,
    { id: string; code: string; name: string; curriculum_group: string }
  >();
  for (const row of assignmentRows ?? []) {
    const subj = Array.isArray(row.subject) ? row.subject[0] : row.subject;
    if (!subj) continue;
    const s = subj as { id: string; code: string; name: string; curriculum_group: string };
    subjectMap.set(s.id, s);
  }

  return {
    student: {
      id: studentRow.id as string,
      nis: studentRow.nis as string,
      nisn: (studentRow.nisn as string | null) ?? null,
      gender: (studentRow.gender as "L" | "P" | null) ?? null,
      guardian_name: (studentRow.guardian_name as string | null) ?? null,
      guardian_phone: (studentRow.guardian_phone as string | null) ?? null,
      is_active: Boolean(studentRow.is_active),
    },
    activeClass: {
      id: clsObj.id,
      name: clsObj.name,
      grade_level: clsObj.grade_level,
      program: clsObj.program ?? null,
      academic_year_name: yearRel?.name ?? "-",
      semester: yearRel?.semester ?? "-",
    },
    subjects: Array.from(subjectMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
  };
}
