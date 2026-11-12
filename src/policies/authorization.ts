import type {
  AuthenticatedActor,
  PermissionCode,
  Phase1RoleCode,
  RoleCode,
} from "@/domain/auth/types";

const ROLE_PERMISSIONS_MAP: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  admin: [
    "school.settings.read",
    "school.settings.write",
    "students.read",
    "students.write",
    "teachers.read",
    "teachers.write",
    "classes.read",
    "classes.write",
    "subjects.read",
    "subjects.write",
    "audit.read",
    "questions.read",
    "questions.write",
    "exams.read",
    "exams.write",
    "exams.publish",
    "exams.oversight",
    "exams.grade",
    "exams.results.release",
    "monitoring.read",
    "monitoring.incidents.write",
    "monitoring.policies.write",
    "monitoring.oversight",
    "monitoring.reports.export",
  ],
  teacher: [
    "classes.read",
    "subjects.read",
    "students.read",
    "teacher.workspace.access",
    "questions.read",
    "questions.write",
    "exams.read",
    "exams.write",
    "exams.publish",
    "exams.grade",
    "exams.results.release",
    "monitoring.read",
    "monitoring.incidents.write",
    "monitoring.policies.write",
    "monitoring.reports.export",
  ],
  student: [
    "student.portal.access",
    "student.exams.read",
    "student.attempts.write",
    "student.results.read",
  ],
  exam_coordinator: [
    "classes.read",
    "subjects.read",
    "teacher.workspace.access",
    "monitoring.read",
    "monitoring.incidents.write",
    "monitoring.policies.write",
    "monitoring.oversight",
    "monitoring.reports.export",
  ],
  proctor: ["classes.read", "monitoring.read", "monitoring.incidents.write"],
  auditor: [
    "audit.read",
    "monitoring.read",
    "monitoring.oversight",
    "monitoring.reports.export",
  ],
};

export function hasRole(roles: readonly RoleCode[], target: RoleCode): boolean {
  return roles.includes(target);
}

export function hasAnyRole(roles: readonly RoleCode[], targets: readonly RoleCode[]): boolean {
  return targets.some((role) => roles.includes(role));
}

export function hasPermission(roles: readonly RoleCode[], permission: PermissionCode): boolean {
  return roles.some((role) => ROLE_PERMISSIONS_MAP[role].includes(permission));
}

export function resolvePrimaryRole(roles: readonly RoleCode[]): Phase1RoleCode | null {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("teacher")) return "teacher";
  if (roles.includes("student")) return "student";
  return null;
}

export function getDefaultPortalPath(roles: readonly RoleCode[]): string {
  const primary = resolvePrimaryRole(roles);
  if (primary === "admin") return "/admin";
  if (primary === "teacher") return "/teacher";
  if (primary === "student") return "/student";
  return "/login";
}

export function canAccessPortalRoute(roles: readonly RoleCode[], pathname: string): boolean {
  if (pathname.startsWith("/admin")) {
    return hasRole(roles, "admin");
  }
  if (pathname.startsWith("/teacher")) {
    return hasRole(roles, "teacher");
  }
  if (pathname.startsWith("/student")) {
    return hasRole(roles, "student");
  }
  if (pathname === "/dashboard") {
    return resolvePrimaryRole(roles) !== null;
  }
  return true;
}

export function canManageSchoolResource(
  actor: AuthenticatedActor,
  targetSchoolId: string,
  requiredPermission: PermissionCode
): boolean {
  if (!actor.isActive) return false;
  if (actor.schoolId !== targetSchoolId) return false;
  return hasPermission(actor.roles, requiredPermission);
}

export function canViewStudentRecord(params: {
  actor: AuthenticatedActor;
  studentUserId: string;
  studentSchoolId: string;
  isEnrolledInActorClass?: boolean;
}): boolean {
  const { actor, studentUserId, studentSchoolId, isEnrolledInActorClass = false } = params;
  if (!actor.isActive || actor.schoolId !== studentSchoolId) return false;
  if (hasRole(actor.roles, "admin")) return true;
  if (hasRole(actor.roles, "teacher") && isEnrolledInActorClass) return true;
  if (hasRole(actor.roles, "student") && actor.userId === studentUserId) return true;
  return false;
}
