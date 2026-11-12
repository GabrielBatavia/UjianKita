export type RoleCode =
  | "admin"
  | "teacher"
  | "student"
  | "exam_coordinator"
  | "proctor"
  | "auditor";

export type Phase1RoleCode = "admin" | "teacher" | "student";

export type PermissionCode =
  | "school.settings.read"
  | "school.settings.write"
  | "students.read"
  | "students.write"
  | "teachers.read"
  | "teachers.write"
  | "classes.read"
  | "classes.write"
  | "subjects.read"
  | "subjects.write"
  | "audit.read"
  | "teacher.workspace.access"
  | "student.portal.access"
  | "questions.read"
  | "questions.write"
  | "exams.read"
  | "exams.write"
  | "exams.publish"
  | "exams.oversight"
  | "exams.grade"
  | "exams.results.release"
  | "student.exams.read"
  | "student.attempts.write"
  | "student.results.read";

export interface AuthenticatedActor {
  userId: string;
  email: string;
  fullName: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  schoolLevel: "SD" | "SMP" | "SMA" | "SMK" | "OTHER";
  timezone: string;
  isActive: boolean;
  roles: RoleCode[];
  primaryRole: Phase1RoleCode;
}
