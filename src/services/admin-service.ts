import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import type {
  AcademicYearRecord,
  ClassroomRecord,
  SchoolRecord,
  StudentRecord,
  SubjectRecord,
  TeacherRecord,
} from "@/domain/academic/types";
import type { AuditEventRecord } from "@/domain/audit/types";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canManageSchoolResource } from "@/policies/authorization";
import {
  fetchAcademicYears,
  fetchAdminOverviewStats,
  fetchClasses,
  fetchSchoolById,
  fetchStudents,
  fetchSubjects,
  fetchTeachers,
  type AdminOverviewStats,
} from "@/repositories/academic-repository";
import { fetchSchoolAuditEvents, recordAuditEvent } from "@/repositories/audit-repository";
import {
  createAcademicYearSchema,
  createClassSchema,
  createStudentSchema,
  createSubjectSchema,
  createTeacherAssignmentSchema,
  createTeacherSchema,
  updateClassSchema,
  updateSchoolSettingsSchema,
  updateStudentSchema,
  updateSubjectSchema,
  updateTeacherSchema,
} from "@/schemas/academic";
import { ServiceError } from "@/services/errors";

export interface RequestAuditContext {
  ipAddress: string | null;
  userAgent: string | null;
}

function assertAdminPermission(
  actor: AuthenticatedActor,
  permission: Parameters<typeof canManageSchoolResource>[2]
) {
  if (!canManageSchoolResource(actor, actor.schoolId, permission)) {
    throw new ServiceError(403, "FORBIDDEN", "Akses ditolak untuk tindakan administratif ini.");
  }
}

export async function getAdminOverview(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{
  stats: AdminOverviewStats;
  recentAudit: AuditEventRecord[];
  school: SchoolRecord | null;
}> {
  assertAdminPermission(actor, "school.settings.read");
  const [stats, recentAudit, school] = await Promise.all([
    fetchAdminOverviewStats(supabase, actor.schoolId),
    fetchSchoolAuditEvents(supabase, actor.schoolId, 8),
    fetchSchoolById(supabase, actor.schoolId),
  ]);
  return { stats, recentAudit, school };
}

export async function getStudentsPageData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{ students: StudentRecord[]; classes: ClassroomRecord[] }> {
  assertAdminPermission(actor, "students.read");
  const [students, classes] = await Promise.all([
    fetchStudents(supabase, actor.schoolId),
    fetchClasses(supabase, actor.schoolId),
  ]);
  return { students, classes };
}

export async function createStudentService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ studentId: string }> {
  assertAdminPermission(actor, "students.write");

  const parsed = createStudentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data siswa tidak valid."
    );
  }
  const input = parsed.data;

  if (!getPublicEnvStatus().serviceRoleConfigured) {
    throw new ServiceError(
      503,
      "SERVICE_ROLE_MISSING",
      "Pembuatan akun siswa memerlukan SUPABASE_SERVICE_ROLE_KEY pada server."
    );
  }

  // Validate class belongs to same school and has an academic year before creating auth user
  let targetClassAcademicYearId: string | null = null;
  if (input.classId) {
    const { data: cls, error: clsError } = await supabase
      .from("classes")
      .select("id, school_id, academic_year_id")
      .eq("id", input.classId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();
    if (clsError || !cls) {
      throw new ServiceError(400, "INVALID_CLASS", "Kelas yang dipilih tidak ditemukan pada sekolah ini.");
    }
    targetClassAcademicYearId = cls.academic_year_id as string;
  }

  const adminClient = createSupabaseAdminClient();

  const { data: roleRow, error: roleError } = await adminClient
    .from("roles")
    .select("id")
    .eq("code", "student")
    .single();

  if (roleError || !roleRow) {
    throw new ServiceError(500, "ROLE_LOOKUP_FAILED", "Referensi peran siswa tidak ditemukan.");
  }

  const { data: createdAuth, error: authCreateError } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.initialPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (authCreateError || !createdAuth.user) {
    const msg = authCreateError?.message?.toLowerCase().includes("already")
      ? "Email tersebut sudah terdaftar pada sistem."
      : "Gagal membuat akun autentikasi siswa.";
    throw new ServiceError(409, "AUTH_USER_CREATE_FAILED", msg);
  }

  const newUserId = createdAuth.user.id;

  try {
    const { error: profileErr } = await adminClient.from("user_profiles").insert({
      id: newUserId,
      school_id: actor.schoolId,
      full_name: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      is_active: true,
      must_change_password: true,
    });
    if (profileErr) throw new Error(profileErr.message);

    const { error: userRoleErr } = await adminClient.from("user_roles").insert({
      user_id: newUserId,
      role_id: roleRow.id,
      school_id: actor.schoolId,
      assigned_by: actor.userId,
    });
    if (userRoleErr) throw new Error(userRoleErr.message);

    const { data: studentRow, error: studentErr } = await adminClient
      .from("students")
      .insert({
        user_id: newUserId,
        school_id: actor.schoolId,
        nis: input.nis,
        nisn: input.nisn,
        gender: input.gender ?? null,
        guardian_name: input.guardianName,
        guardian_phone: input.guardianPhone,
        is_active: true,
      })
      .select("id")
      .single();

    if (studentErr || !studentRow) {
      throw new Error(studentErr?.message ?? "Gagal menyimpan data siswa.");
    }

    if (input.classId && targetClassAcademicYearId) {
      const { error: enrollErr } = await adminClient.from("class_enrollments").insert({
        school_id: actor.schoolId,
        class_id: input.classId,
        student_id: studentRow.id,
        academic_year_id: targetClassAcademicYearId,
        status: "active",
      });
      if (enrollErr) throw new Error(enrollErr.message);
    }

    await recordAuditEvent(supabase, {
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      action: "student.created",
      entityType: "student",
      entityId: studentRow.id as string,
      summary: `Menambahkan akun siswa ${input.fullName} (NIS: ${input.nis})`,
      metadata: { nis: input.nis, classId: input.classId ?? null },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { studentId: studentRow.id as string };
  } catch (err) {
    // Compensating rollback to keep Auth and relational records consistent
    await adminClient.auth.admin.deleteUser(newUserId);
    const msg = err instanceof Error ? err.message : "Gagal menyimpan data siswa";
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      throw new ServiceError(409, "DUPLICATE_STUDENT", "NIS atau NISN sudah digunakan oleh siswa lain.");
    }
    throw new ServiceError(400, "STUDENT_CREATE_FAILED", msg);
  }
}

export async function updateStudentService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  studentId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "students.write");

  const parsed = updateStudentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan siswa tidak valid."
    );
  }
  const input = parsed.data;

  const { data: existing, error: fetchErr } = await supabase
    .from("students")
    .select("id, user_id, school_id, is_active")
    .eq("id", studentId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (fetchErr || !existing) {
    throw new ServiceError(404, "STUDENT_NOT_FOUND", "Data siswa tidak ditemukan.");
  }

  const { error: profileErr } = await supabase
    .from("user_profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone,
      is_active: input.isActive,
    })
    .eq("id", existing.user_id)
    .eq("school_id", actor.schoolId);

  if (profileErr) {
    throw new ServiceError(400, "STUDENT_UPDATE_FAILED", "Gagal memperbarui profil siswa.");
  }

  const { error: studentErr } = await supabase
    .from("students")
    .update({
      nis: input.nis,
      nisn: input.nisn,
      gender: input.gender ?? null,
      guardian_name: input.guardianName,
      guardian_phone: input.guardianPhone,
      is_active: input.isActive,
    })
    .eq("id", studentId)
    .eq("school_id", actor.schoolId);

  if (studentErr) {
    throw new ServiceError(
      400,
      "STUDENT_UPDATE_FAILED",
      studentErr.code === "23505"
        ? "NIS atau NISN sudah digunakan oleh siswa lain."
        : "Gagal memperbarui data akademik siswa."
    );
  }

  if (input.classId !== undefined) {
    if (input.classId) {
      const { data: targetClass, error: clsErr } = await supabase
        .from("classes")
        .select("id, academic_year_id")
        .eq("id", input.classId)
        .eq("school_id", actor.schoolId)
        .maybeSingle();

      if (clsErr || !targetClass) {
        throw new ServiceError(400, "INVALID_CLASS", "Kelas tujuan tidak ditemukan.");
      }

      await supabase
        .from("class_enrollments")
        .update({ status: "transferred" })
        .eq("student_id", studentId)
        .eq("academic_year_id", targetClass.academic_year_id)
        .eq("status", "active");

      const { error: upsertErr } = await supabase.from("class_enrollments").upsert(
        {
          school_id: actor.schoolId,
          class_id: targetClass.id,
          student_id: studentId,
          academic_year_id: targetClass.academic_year_id,
          status: "active",
        },
        { onConflict: "class_id,student_id" }
      );

      if (upsertErr) {
        throw new ServiceError(400, "ENROLLMENT_FAILED", "Gagal menempatkan siswa ke kelas baru.");
      }
    } else {
      await supabase
        .from("class_enrollments")
        .update({ status: "inactive" })
        .eq("student_id", studentId)
        .eq("status", "active");
    }
  }

  if (existing.is_active !== input.isActive && getPublicEnvStatus().serviceRoleConfigured) {
    const adminClient = createSupabaseAdminClient();
    await adminClient.auth.admin.updateUserById(existing.user_id, {
      ban_duration: input.isActive ? "none" : "876000h",
    });
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: existing.is_active !== input.isActive ? "student.status_changed" : "student.updated",
    entityType: "student",
    entityId: studentId,
    summary: `Memperbarui data siswa ${input.fullName} (NIS: ${input.nis})`,
    metadata: { isActive: input.isActive, classId: input.classId ?? null },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getTeachersPageData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{
  teachers: TeacherRecord[];
  classes: ClassroomRecord[];
  subjects: SubjectRecord[];
  academicYears: AcademicYearRecord[];
}> {
  assertAdminPermission(actor, "teachers.read");
  const [teachers, classes, subjects, academicYears] = await Promise.all([
    fetchTeachers(supabase, actor.schoolId),
    fetchClasses(supabase, actor.schoolId),
    fetchSubjects(supabase, actor.schoolId),
    fetchAcademicYears(supabase, actor.schoolId),
  ]);
  return { teachers, classes, subjects, academicYears };
}

export async function createTeacherService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ teacherId: string }> {
  assertAdminPermission(actor, "teachers.write");

  const parsed = createTeacherSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data guru tidak valid."
    );
  }
  const input = parsed.data;

  if (!getPublicEnvStatus().serviceRoleConfigured) {
    throw new ServiceError(
      503,
      "SERVICE_ROLE_MISSING",
      "Pembuatan akun guru memerlukan SUPABASE_SERVICE_ROLE_KEY pada server."
    );
  }

  const adminClient = createSupabaseAdminClient();
  const { data: roleRow, error: roleError } = await adminClient
    .from("roles")
    .select("id")
    .eq("code", "teacher")
    .single();

  if (roleError || !roleRow) {
    throw new ServiceError(500, "ROLE_LOOKUP_FAILED", "Referensi peran guru tidak ditemukan.");
  }

  const { data: createdAuth, error: authCreateError } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.initialPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (authCreateError || !createdAuth.user) {
    const msg = authCreateError?.message?.toLowerCase().includes("already")
      ? "Email tersebut sudah terdaftar pada sistem."
      : "Gagal membuat akun autentikasi guru.";
    throw new ServiceError(409, "AUTH_USER_CREATE_FAILED", msg);
  }

  const newUserId = createdAuth.user.id;

  try {
    const { error: profileErr } = await adminClient.from("user_profiles").insert({
      id: newUserId,
      school_id: actor.schoolId,
      full_name: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      is_active: true,
      must_change_password: true,
    });
    if (profileErr) throw new Error(profileErr.message);

    const { error: userRoleErr } = await adminClient.from("user_roles").insert({
      user_id: newUserId,
      role_id: roleRow.id,
      school_id: actor.schoolId,
      assigned_by: actor.userId,
    });
    if (userRoleErr) throw new Error(userRoleErr.message);

    const { data: teacherRow, error: teacherErr } = await adminClient
      .from("teachers")
      .insert({
        user_id: newUserId,
        school_id: actor.schoolId,
        nip: input.nip,
        specialization: input.specialization,
        employment_status: input.employmentStatus,
        is_active: true,
      })
      .select("id")
      .single();

    if (teacherErr || !teacherRow) {
      throw new Error(teacherErr?.message ?? "Gagal menyimpan data guru.");
    }

    await recordAuditEvent(supabase, {
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      action: "teacher.created",
      entityType: "teacher",
      entityId: teacherRow.id as string,
      summary: `Menambahkan akun guru ${input.fullName}`,
      metadata: { nip: input.nip, employmentStatus: input.employmentStatus },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { teacherId: teacherRow.id as string };
  } catch (err) {
    await adminClient.auth.admin.deleteUser(newUserId);
    const msg = err instanceof Error ? err.message : "Gagal menyimpan data guru";
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      throw new ServiceError(409, "DUPLICATE_TEACHER", "NIP sudah digunakan oleh guru lain.");
    }
    throw new ServiceError(400, "TEACHER_CREATE_FAILED", msg);
  }
}

export async function updateTeacherService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  teacherId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "teachers.write");

  const parsed = updateTeacherSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan guru tidak valid."
    );
  }
  const input = parsed.data;

  const { data: existing, error: fetchErr } = await supabase
    .from("teachers")
    .select("id, user_id, is_active")
    .eq("id", teacherId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (fetchErr || !existing) {
    throw new ServiceError(404, "TEACHER_NOT_FOUND", "Data guru tidak ditemukan.");
  }

  const { error: profileErr } = await supabase
    .from("user_profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone,
      is_active: input.isActive,
    })
    .eq("id", existing.user_id)
    .eq("school_id", actor.schoolId);

  if (profileErr) {
    throw new ServiceError(400, "TEACHER_UPDATE_FAILED", "Gagal memperbarui profil guru.");
  }

  const { error: teacherErr } = await supabase
    .from("teachers")
    .update({
      nip: input.nip,
      specialization: input.specialization,
      employment_status: input.employmentStatus,
      is_active: input.isActive,
    })
    .eq("id", teacherId)
    .eq("school_id", actor.schoolId);

  if (teacherErr) {
    throw new ServiceError(
      400,
      "TEACHER_UPDATE_FAILED",
      teacherErr.code === "23505"
        ? "NIP sudah digunakan oleh guru lain."
        : "Gagal memperbarui data guru."
    );
  }

  if (existing.is_active !== input.isActive && getPublicEnvStatus().serviceRoleConfigured) {
    const adminClient = createSupabaseAdminClient();
    await adminClient.auth.admin.updateUserById(existing.user_id, {
      ban_duration: input.isActive ? "none" : "876000h",
    });
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: existing.is_active !== input.isActive ? "teacher.status_changed" : "teacher.updated",
    entityType: "teacher",
    entityId: teacherId,
    summary: `Memperbarui data guru ${input.fullName}`,
    metadata: { isActive: input.isActive },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function assignTeacherService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "teachers.write");
  const parsed = createTeacherAssignmentSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data penugasan guru tidak valid."
    );
  }
  const input = parsed.data;

  // Verify every referenced entity belongs to the actor's school
  const [teacherRes, classRes, subjectRes, yearRes] = await Promise.all([
    supabase
      .from("teachers")
      .select("id")
      .eq("id", input.teacherId)
      .eq("school_id", actor.schoolId)
      .maybeSingle(),
    supabase
      .from("classes")
      .select("id")
      .eq("id", input.classId)
      .eq("school_id", actor.schoolId)
      .maybeSingle(),
    supabase
      .from("subjects")
      .select("id")
      .eq("id", input.subjectId)
      .eq("school_id", actor.schoolId)
      .maybeSingle(),
    supabase
      .from("academic_years")
      .select("id")
      .eq("id", input.academicYearId)
      .eq("school_id", actor.schoolId)
      .maybeSingle(),
  ]);

  if (!teacherRes.data || !classRes.data || !subjectRes.data || !yearRes.data) {
    throw new ServiceError(
      400,
      "INVALID_SCHOOL_REFERENCE",
      "Guru, kelas, mata pelajaran, atau tahun ajaran tidak ditemukan pada sekolah ini."
    );
  }

  const { data: created, error } = await supabase
    .from("teacher_assignments")
    .insert({
      school_id: actor.schoolId,
      teacher_id: input.teacherId,
      class_id: input.classId,
      subject_id: input.subjectId,
      academic_year_id: input.academicYearId,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new ServiceError(
      400,
      "ASSIGNMENT_FAILED",
      error?.code === "23505"
        ? "Guru sudah ditugaskan untuk kelas dan mata pelajaran tersebut."
        : "Gagal menyimpan penugasan guru."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "teacher.assigned",
    entityType: "teacher_assignment",
    entityId: created.id as string,
    summary: "Menetapkan penugasan mengajar guru ke kelas dan mata pelajaran",
    metadata: input,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function removeTeacherAssignmentService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  assignmentId: string,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "teachers.write");

  const { error } = await supabase
    .from("teacher_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("school_id", actor.schoolId);

  if (error) {
    throw new ServiceError(400, "UNASSIGN_FAILED", "Gagal menghapus penugasan guru.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "teacher.unassigned",
    entityType: "teacher_assignment",
    entityId: assignmentId,
    summary: "Menghapus penugasan mengajar guru",
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getClassesPageData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{
  classes: ClassroomRecord[];
  academicYears: AcademicYearRecord[];
  teachers: TeacherRecord[];
}> {
  assertAdminPermission(actor, "classes.read");
  const [classes, academicYears, teachers] = await Promise.all([
    fetchClasses(supabase, actor.schoolId),
    fetchAcademicYears(supabase, actor.schoolId),
    fetchTeachers(supabase, actor.schoolId),
  ]);
  return { classes, academicYears, teachers };
}

export async function createAcademicYearService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ id: string }> {
  assertAdminPermission(actor, "classes.write");
  const parsed = createAcademicYearSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data tahun ajaran tidak valid."
    );
  }
  const input = parsed.data;

  if (input.isActive) {
    await supabase
      .from("academic_years")
      .update({ is_active: false })
      .eq("school_id", actor.schoolId)
      .eq("is_active", true);
  }

  const { data: created, error } = await supabase
    .from("academic_years")
    .insert({
      school_id: actor.schoolId,
      name: input.name,
      semester: input.semester,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      is_active: input.isActive,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new ServiceError(
      400,
      "ACADEMIC_YEAR_CREATE_FAILED",
      error?.code === "23505"
        ? "Tahun ajaran dan semester tersebut sudah ada."
        : "Gagal menambahkan tahun ajaran."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "academic_year.created",
    entityType: "academic_year",
    entityId: created.id as string,
    summary: `Menambahkan tahun ajaran ${input.name} (${input.semester})`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { id: created.id as string };
}

export async function activateAcademicYearService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  academicYearId: string,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "classes.write");

  const { data: targetYear, error: fetchErr } = await supabase
    .from("academic_years")
    .select("id, name, semester")
    .eq("id", academicYearId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (fetchErr || !targetYear) {
    throw new ServiceError(404, "ACADEMIC_YEAR_NOT_FOUND", "Tahun ajaran tidak ditemukan.");
  }

  const { error: rpcErr } = await supabase.rpc("activate_academic_year", {
    target_year_id: academicYearId,
  });

  if (rpcErr) {
    throw new ServiceError(400, "ACADEMIC_YEAR_ACTIVATE_FAILED", "Gagal mengaktifkan tahun ajaran.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "academic_year.activated",
    entityType: "academic_year",
    entityId: academicYearId,
    summary: `Mengaktifkan tahun ajaran ${targetYear.name} (${targetYear.semester})`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function createClassService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ id: string }> {
  assertAdminPermission(actor, "classes.write");
  const parsed = createClassSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data kelas tidak valid."
    );
  }
  const input = parsed.data;

  const { data: validYear } = await supabase
    .from("academic_years")
    .select("id")
    .eq("id", input.academicYearId)
    .eq("school_id", actor.schoolId)
    .maybeSingle();

  if (!validYear) {
    throw new ServiceError(400, "INVALID_ACADEMIC_YEAR", "Tahun ajaran tidak valid untuk sekolah ini.");
  }

  if (input.homeroomTeacherId) {
    const { data: validTeacher } = await supabase
      .from("teachers")
      .select("id")
      .eq("id", input.homeroomTeacherId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();

    if (!validTeacher) {
      throw new ServiceError(400, "INVALID_TEACHER", "Wali kelas tidak ditemukan pada sekolah ini.");
    }
  }

  const { data: created, error } = await supabase
    .from("classes")
    .insert({
      school_id: actor.schoolId,
      academic_year_id: input.academicYearId,
      name: input.name,
      grade_level: input.gradeLevel,
      program: input.program,
      homeroom_teacher_id: input.homeroomTeacherId ?? null,
      capacity: input.capacity ?? null,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new ServiceError(
      400,
      "CLASS_CREATE_FAILED",
      error?.code === "23505"
        ? "Nama kelas sudah digunakan pada tahun ajaran yang sama."
        : "Gagal menambahkan kelas."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "class.created",
    entityType: "class",
    entityId: created.id as string,
    summary: `Menambahkan kelas ${input.name} (Tingkat ${input.gradeLevel})`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { id: created.id as string };
}

export async function updateClassService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  classId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "classes.write");
  const parsed = updateClassSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data pembaruan kelas tidak valid."
    );
  }
  const input = parsed.data;

  if (input.homeroomTeacherId) {
    const { data: validTeacher } = await supabase
      .from("teachers")
      .select("id")
      .eq("id", input.homeroomTeacherId)
      .eq("school_id", actor.schoolId)
      .maybeSingle();

    if (!validTeacher) {
      throw new ServiceError(400, "INVALID_TEACHER", "Wali kelas tidak ditemukan pada sekolah ini.");
    }
  }

  const { error } = await supabase
    .from("classes")
    .update({
      name: input.name,
      grade_level: input.gradeLevel,
      program: input.program,
      homeroom_teacher_id: input.homeroomTeacherId ?? null,
      capacity: input.capacity ?? null,
      is_active: input.isActive,
    })
    .eq("id", classId)
    .eq("school_id", actor.schoolId);

  if (error) {
    throw new ServiceError(
      400,
      "CLASS_UPDATE_FAILED",
      error.code === "23505"
        ? "Nama kelas sudah digunakan pada tahun ajaran yang sama."
        : "Gagal memperbarui kelas."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "class.updated",
    entityType: "class",
    entityId: classId,
    summary: `Memperbarui kelas ${input.name}`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getSubjectsPageData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{ subjects: SubjectRecord[] }> {
  assertAdminPermission(actor, "subjects.read");
  const subjects = await fetchSubjects(supabase, actor.schoolId);
  return { subjects };
}

export async function createSubjectService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<{ id: string }> {
  assertAdminPermission(actor, "subjects.write");
  const parsed = createSubjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data mata pelajaran tidak valid."
    );
  }
  const input = parsed.data;

  const { data: created, error } = await supabase
    .from("subjects")
    .insert({
      school_id: actor.schoolId,
      code: input.code,
      name: input.name,
      curriculum_group: input.curriculumGroup,
      description: input.description,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new ServiceError(
      400,
      "SUBJECT_CREATE_FAILED",
      error?.code === "23505"
        ? "Kode mata pelajaran sudah digunakan."
        : "Gagal menambahkan mata pelajaran."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "subject.created",
    entityType: "subject",
    entityId: created.id as string,
    summary: `Menambahkan mata pelajaran ${input.code} — ${input.name}`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { id: created.id as string };
}

export async function updateSubjectService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  subjectId: string,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "subjects.write");
  const parsed = updateSubjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Data mata pelajaran tidak valid."
    );
  }
  const input = parsed.data;

  const { error } = await supabase
    .from("subjects")
    .update({
      code: input.code,
      name: input.name,
      curriculum_group: input.curriculumGroup,
      description: input.description,
      is_active: input.isActive,
    })
    .eq("id", subjectId)
    .eq("school_id", actor.schoolId);

  if (error) {
    throw new ServiceError(
      400,
      "SUBJECT_UPDATE_FAILED",
      error.code === "23505"
        ? "Kode mata pelajaran sudah digunakan."
        : "Gagal memperbarui mata pelajaran."
    );
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "subject.updated",
    entityType: "subject",
    entityId: subjectId,
    summary: `Memperbarui mata pelajaran ${input.code} — ${input.name}`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}

export async function getSettingsPageData(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<{ school: SchoolRecord; auditEvents: AuditEventRecord[] }> {
  assertAdminPermission(actor, "school.settings.read");
  const [school, auditEvents] = await Promise.all([
    fetchSchoolById(supabase, actor.schoolId),
    fetchSchoolAuditEvents(supabase, actor.schoolId, 30),
  ]);

  if (!school) {
    throw new ServiceError(404, "SCHOOL_NOT_FOUND", "Data sekolah tidak ditemukan.");
  }

  return { school, auditEvents };
}

export async function updateSchoolSettingsService(
  supabase: SupabaseClient,
  actor: AuthenticatedActor,
  rawInput: unknown,
  ctx: RequestAuditContext
): Promise<void> {
  assertAdminPermission(actor, "school.settings.write");
  const parsed = updateSchoolSettingsSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Pengaturan sekolah tidak valid."
    );
  }
  const input = parsed.data;

  const { error } = await supabase
    .from("schools")
    .update({
      name: input.name,
      npsn: input.npsn,
      level: input.level,
      address: input.address,
      phone: input.phone,
      email: input.email,
      timezone: input.timezone,
      academic_calendar_note: input.academicCalendarNote,
      result_release_policy: input.resultReleasePolicy,
      exam_policy: {
        require_exam_browser_in_high_stakes: input.requireExamBrowserInHighStakes,
        allow_late_join_minutes: input.allowLateJoinMinutes,
        heartbeat_interval_seconds: input.heartbeatIntervalSeconds,
      },
    })
    .eq("id", actor.schoolId);

  if (error) {
    throw new ServiceError(400, "SETTINGS_UPDATE_FAILED", "Gagal menyimpan pengaturan sekolah.");
  }

  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "school.settings_updated",
    entityType: "school",
    entityId: actor.schoolId,
    summary: `Memperbarui profil dan kebijakan ujian sekolah (${input.name})`,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
}
