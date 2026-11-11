import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/domain/auth/types";
import {
  canAccessPortalRoute,
  canManageSchoolResource,
  canViewStudentRecord,
  getDefaultPortalPath,
  hasPermission,
} from "@/policies/authorization";

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "99999999-9999-4999-8999-999999999999";

function makeActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    userId: "user-1",
    email: "user@school.sch.id",
    fullName: "Pengguna Uji",
    schoolId: SCHOOL_A,
    schoolName: "SMA Negeri 1 Simulasi",
    schoolCode: "SMAN1",
    schoolLevel: "SMA",
    timezone: "Asia/Jakarta",
    isActive: true,
    roles: ["student"],
    primaryRole: "student",
    ...overrides,
  };
}

describe("Authorization policies & RBAC isolation", () => {
  it("routes each role strictly to its own default portal", () => {
    expect(getDefaultPortalPath(["admin"])).toBe("/admin");
    expect(getDefaultPortalPath(["teacher"])).toBe("/teacher");
    expect(getDefaultPortalPath(["student"])).toBe("/student");
    expect(getDefaultPortalPath([])).toBe("/login");
  });

  it("prevents students and teachers from accessing admin routes", () => {
    expect(canAccessPortalRoute(["student"], "/admin")).toBe(false);
    expect(canAccessPortalRoute(["student"], "/admin/students")).toBe(false);
    expect(canAccessPortalRoute(["student"], "/teacher")).toBe(false);
    expect(canAccessPortalRoute(["student"], "/student/profile")).toBe(true);

    expect(canAccessPortalRoute(["teacher"], "/admin")).toBe(false);
    expect(canAccessPortalRoute(["teacher"], "/teacher/classes")).toBe(true);
    expect(canAccessPortalRoute(["admin"], "/admin/settings")).toBe(true);
  });

  it("enforces same-school tenant boundary and active account requirement", () => {
    const adminA = makeActor({ roles: ["admin"], primaryRole: "admin", schoolId: SCHOOL_A });
    const inactiveAdmin = makeActor({
      roles: ["admin"],
      primaryRole: "admin",
      schoolId: SCHOOL_A,
      isActive: false,
    });
    const teacherA = makeActor({ roles: ["teacher"], primaryRole: "teacher", schoolId: SCHOOL_A });

    expect(canManageSchoolResource(adminA, SCHOOL_A, "students.write")).toBe(true);
    expect(canManageSchoolResource(adminA, SCHOOL_B, "students.write")).toBe(false);
    expect(canManageSchoolResource(inactiveAdmin, SCHOOL_A, "students.write")).toBe(false);
    expect(canManageSchoolResource(teacherA, SCHOOL_A, "students.write")).toBe(false);
    expect(hasPermission(["teacher"], "teacher.workspace.access")).toBe(true);
    expect(hasPermission(["student"], "audit.read")).toBe(false);
  });

  it("enforces least privilege for viewing student records", () => {
    const studentSelf = makeActor({ userId: "stu-1", roles: ["student"], primaryRole: "student" });
    const teacher = makeActor({ userId: "tch-1", roles: ["teacher"], primaryRole: "teacher" });

    // Student can only see themselves
    expect(
      canViewStudentRecord({
        actor: studentSelf,
        studentUserId: "stu-1",
        studentSchoolId: SCHOOL_A,
      })
    ).toBe(true);

    expect(
      canViewStudentRecord({
        actor: studentSelf,
        studentUserId: "stu-2",
        studentSchoolId: SCHOOL_A,
      })
    ).toBe(false);

    // Teacher can see enrolled students in their assigned class only
    expect(
      canViewStudentRecord({
        actor: teacher,
        studentUserId: "stu-1",
        studentSchoolId: SCHOOL_A,
        isEnrolledInActorClass: true,
      })
    ).toBe(true);

    expect(
      canViewStudentRecord({
        actor: teacher,
        studentUserId: "stu-2",
        studentSchoolId: SCHOOL_A,
        isEnrolledInActorClass: false,
      })
    ).toBe(false);
  });
});
