export type SchoolLevel = "SD" | "SMP" | "SMA" | "SMK" | "OTHER";

export type ResultReleasePolicy =
  | "manual_review"
  | "scheduled_release"
  | "immediate_after_close";

export interface SchoolExamPolicy {
  require_exam_browser_in_high_stakes: boolean;
  allow_late_join_minutes: number;
  heartbeat_interval_seconds: number;
}

export interface SchoolRecord {
  id: string;
  code: string;
  name: string;
  npsn: string | null;
  level: SchoolLevel;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  academic_calendar_note: string | null;
  result_release_policy: ResultReleasePolicy;
  exam_policy: SchoolExamPolicy;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcademicYearRecord {
  id: string;
  school_id: string;
  name: string;
  semester: "Ganjil" | "Genap" | "Tahunan";
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClassroomRecord {
  id: string;
  school_id: string;
  academic_year_id: string;
  academic_year_name?: string;
  academic_year_semester?: string;
  name: string;
  grade_level: string;
  program: string | null;
  homeroom_teacher_id: string | null;
  homeroom_teacher_name?: string | null;
  capacity: number | null;
  enrolled_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubjectRecord {
  id: string;
  school_id: string;
  code: string;
  name: string;
  curriculum_group: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type EmploymentStatus = "ASN" | "PPPK" | "GTY" | "GTT" | "HONORER" | "LAINNYA";

export interface TeacherRecord {
  id: string;
  user_id: string;
  school_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nip: string | null;
  specialization: string | null;
  employment_status: EmploymentStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  assignments?: TeacherAssignmentSummary[];
}

export interface TeacherAssignmentSummary {
  id: string;
  class_id: string;
  class_name: string;
  grade_level: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  academic_year_id: string;
  academic_year_name: string;
  is_active: boolean;
}

export interface StudentRecord {
  id: string;
  user_id: string;
  school_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nis: string;
  nisn: string | null;
  gender: "L" | "P" | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  is_active: boolean;
  current_class_id: string | null;
  current_class_name: string | null;
  created_at: string;
  updated_at: string;
}
