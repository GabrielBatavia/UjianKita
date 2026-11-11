import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcademicYearRecord,
  ClassroomRecord,
  EmploymentStatus,
  SchoolExamPolicy,
  SchoolLevel,
  SchoolRecord,
  StudentRecord,
  SubjectRecord,
  TeacherAssignmentSummary,
  TeacherRecord,
} from "@/domain/academic/types";

export interface AdminOverviewStats {
  totalStudents: number;
  activeStudents: number;
  totalTeachers: number;
  activeTeachers: number;
  totalClasses: number;
  totalSubjects: number;
  activeAcademicYear: AcademicYearRecord | null;
}

export async function fetchSchoolById(
  supabase: SupabaseClient,
  schoolId: string
): Promise<SchoolRecord | null> {
  const { data, error } = await supabase
    .from("schools")
    .select("*")
    .eq("id", schoolId)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memuat data sekolah: ${error.message}`);
  }
  if (!data) return null;

  return {
    ...(data as Omit<SchoolRecord, "level" | "exam_policy">),
    level: data.level as SchoolLevel,
    exam_policy: data.exam_policy as SchoolExamPolicy,
  };
}

export async function fetchAcademicYears(
  supabase: SupabaseClient,
  schoolId: string
): Promise<AcademicYearRecord[]> {
  const { data, error } = await supabase
    .from("academic_years")
    .select("*")
    .eq("school_id", schoolId)
    .order("is_active", { ascending: false })
    .order("starts_on", { ascending: false });

  if (error) {
    throw new Error(`Gagal memuat tahun ajaran: ${error.message}`);
  }
  return (data ?? []) as AcademicYearRecord[];
}

export async function fetchAdminOverviewStats(
  supabase: SupabaseClient,
  schoolId: string
): Promise<AdminOverviewStats> {
  const [
    totalStudentsRes,
    activeStudentsRes,
    totalTeachersRes,
    activeTeachersRes,
    totalClassesRes,
    totalSubjectsRes,
    activeYearRes,
  ] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_active", true),
    supabase.from("teachers").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase
      .from("teachers")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("is_active", true),
    supabase.from("classes").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase.from("subjects").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase
      .from("academic_years")
      .select("*")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  return {
    totalStudents: totalStudentsRes.count ?? 0,
    activeStudents: activeStudentsRes.count ?? 0,
    totalTeachers: totalTeachersRes.count ?? 0,
    activeTeachers: activeTeachersRes.count ?? 0,
    totalClasses: totalClassesRes.count ?? 0,
    totalSubjects: totalSubjectsRes.count ?? 0,
    activeAcademicYear: (activeYearRes.data as AcademicYearRecord | null) ?? null,
  };
}

export async function fetchClasses(
  supabase: SupabaseClient,
  schoolId: string
): Promise<ClassroomRecord[]> {
  const { data, error } = await supabase
    .from("classes")
    .select(
      `
      *,
      academic_year:academic_year_id ( name, semester ),
      homeroom_teacher:homeroom_teacher_id (
        id,
        profile:user_id ( full_name )
      ),
      enrollments:class_enrollments ( id, status )
    `
    )
    .eq("school_id", schoolId)
    .order("grade_level", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Gagal memuat daftar kelas: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const yearRel = Array.isArray(row.academic_year) ? row.academic_year[0] : row.academic_year;
    const teacherRel = Array.isArray(row.homeroom_teacher)
      ? row.homeroom_teacher[0]
      : row.homeroom_teacher;
    const teacherProfile = teacherRel
      ? Array.isArray((teacherRel as { profile?: unknown }).profile)
        ? ((teacherRel as { profile?: Array<{ full_name?: string }> }).profile?.[0] ?? null)
        : ((teacherRel as { profile?: { full_name?: string } | null }).profile ?? null)
      : null;
    const enrollments = Array.isArray(row.enrollments)
      ? (row.enrollments as Array<{ status?: string }>)
      : [];
    const activeCount = enrollments.filter((e) => e.status === "active").length;

    return {
      id: row.id as string,
      school_id: row.school_id as string,
      academic_year_id: row.academic_year_id as string,
      academic_year_name: (yearRel as { name?: string } | null)?.name,
      academic_year_semester: (yearRel as { semester?: string } | null)?.semester,
      name: row.name as string,
      grade_level: row.grade_level as string,
      program: (row.program as string | null) ?? null,
      homeroom_teacher_id: (row.homeroom_teacher_id as string | null) ?? null,
      homeroom_teacher_name: teacherProfile?.full_name ?? null,
      capacity: (row.capacity as number | null) ?? null,
      enrolled_count: activeCount,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  });
}

export async function fetchSubjects(
  supabase: SupabaseClient,
  schoolId: string
): Promise<SubjectRecord[]> {
  const { data, error } = await supabase
    .from("subjects")
    .select("*")
    .eq("school_id", schoolId)
    .order("code", { ascending: true });

  if (error) {
    throw new Error(`Gagal memuat mata pelajaran: ${error.message}`);
  }
  return (data ?? []) as SubjectRecord[];
}

export async function fetchTeachers(
  supabase: SupabaseClient,
  schoolId: string
): Promise<TeacherRecord[]> {
  const { data, error } = await supabase
    .from("teachers")
    .select(
      `
      id,
      user_id,
      school_id,
      nip,
      specialization,
      employment_status,
      is_active,
      created_at,
      updated_at,
      profile:user_id (
        full_name,
        email,
        phone
      ),
      assignments:teacher_assignments (
        id,
        is_active,
        class:class_id ( id, name, grade_level ),
        subject:subject_id ( id, code, name ),
        academic_year:academic_year_id ( id, name )
      )
    `
    )
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Gagal memuat daftar guru: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const profileRel = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    const rawAssignments = Array.isArray(row.assignments) ? row.assignments : [];

    const assignments: TeacherAssignmentSummary[] = rawAssignments.map((a) => {
      const cls = Array.isArray(a.class) ? a.class[0] : a.class;
      const subj = Array.isArray(a.subject) ? a.subject[0] : a.subject;
      const year = Array.isArray(a.academic_year) ? a.academic_year[0] : a.academic_year;
      return {
        id: a.id as string,
        class_id: (cls as { id?: string } | null)?.id ?? "",
        class_name: (cls as { name?: string } | null)?.name ?? "-",
        grade_level: (cls as { grade_level?: string } | null)?.grade_level ?? "-",
        subject_id: (subj as { id?: string } | null)?.id ?? "",
        subject_code: (subj as { code?: string } | null)?.code ?? "-",
        subject_name: (subj as { name?: string } | null)?.name ?? "-",
        academic_year_id: (year as { id?: string } | null)?.id ?? "",
        academic_year_name: (year as { name?: string } | null)?.name ?? "-",
        is_active: Boolean(a.is_active),
      };
    });

    return {
      id: row.id as string,
      user_id: row.user_id as string,
      school_id: row.school_id as string,
      full_name: (profileRel as { full_name?: string } | null)?.full_name ?? "-",
      email: (profileRel as { email?: string } | null)?.email ?? "-",
      phone: (profileRel as { phone?: string | null } | null)?.phone ?? null,
      nip: (row.nip as string | null) ?? null,
      specialization: (row.specialization as string | null) ?? null,
      employment_status: row.employment_status as EmploymentStatus,
      is_active: Boolean(row.is_active),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      assignments,
    };
  });
}

export async function fetchStudents(
  supabase: SupabaseClient,
  schoolId: string
): Promise<StudentRecord[]> {
  const { data, error } = await supabase
    .from("students")
    .select(
      `
      id,
      user_id,
      school_id,
      nis,
      nisn,
      gender,
      guardian_name,
      guardian_phone,
      is_active,
      created_at,
      updated_at,
      profile:user_id (
        full_name,
        email,
        phone
      ),
      enrollments:class_enrollments (
        id,
        status,
        class:class_id (
          id,
          name
        )
      )
    `
    )
    .eq("school_id", schoolId)
    .order("nis", { ascending: true });

  if (error) {
    throw new Error(`Gagal memuat daftar siswa: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const profileRel = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    const enrollments = Array.isArray(row.enrollments)
      ? (row.enrollments as Array<{ status?: string; class?: unknown }>)
      : [];
    const activeEnrollment = enrollments.find((e) => e.status === "active");
    const activeClass = activeEnrollment
      ? Array.isArray((activeEnrollment as { class?: unknown }).class)
        ? ((activeEnrollment as { class?: Array<{ id?: string; name?: string }> }).class?.[0] ?? null)
        : ((activeEnrollment as { class?: { id?: string; name?: string } | null }).class ?? null)
      : null;

    return {
      id: row.id as string,
      user_id: row.user_id as string,
      school_id: row.school_id as string,
      full_name: (profileRel as { full_name?: string } | null)?.full_name ?? "-",
      email: (profileRel as { email?: string } | null)?.email ?? "-",
      phone: (profileRel as { phone?: string | null } | null)?.phone ?? null,
      nis: row.nis as string,
      nisn: (row.nisn as string | null) ?? null,
      gender: (row.gender as "L" | "P" | null) ?? null,
      guardian_name: (row.guardian_name as string | null) ?? null,
      guardian_phone: (row.guardian_phone as string | null) ?? null,
      is_active: Boolean(row.is_active),
      current_class_id: activeClass?.id ?? null,
      current_class_name: activeClass?.name ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  });
}
