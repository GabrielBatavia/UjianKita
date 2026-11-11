import { z } from "zod";

const optionalTrimmedString = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength, `Maksimal ${maxLength} karakter`)
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? val : null));

export const createStudentSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap siswa minimal 2 karakter")
    .max(120, "Nama lengkap maksimal 120 karakter"),
  email: z
    .string()
    .trim()
    .email("Format email siswa tidak valid")
    .max(254, "Email terlalu panjang"),
  initialPassword: z
    .string()
    .min(8, "Kata sandi awal minimal 8 karakter")
    .max(128, "Kata sandi maksimal 128 karakter"),
  nis: z
    .string()
    .trim()
    .min(3, "NIS minimal 3 karakter")
    .max(30, "NIS maksimal 30 karakter")
    .regex(/^[A-Za-z0-9._-]+$/, "NIS hanya boleh berisi huruf, angka, titik, atau tanda hubung"),
  nisn: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || /^\d{10}$/.test(val), {
      message: "NISN harus terdiri dari tepat 10 digit angka",
    })
    .transform((val) => (val && val.length > 0 ? val : null)),
  gender: z.enum(["L", "P"]).optional().nullable(),
  phone: optionalTrimmedString(30),
  guardianName: optionalTrimmedString(120),
  guardianPhone: optionalTrimmedString(30),
  classId: z.string().uuid("ID kelas tidak valid").optional().nullable(),
});

export const updateStudentSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap siswa minimal 2 karakter")
    .max(120, "Nama lengkap maksimal 120 karakter"),
  nis: z
    .string()
    .trim()
    .min(3, "NIS minimal 3 karakter")
    .max(30, "NIS maksimal 30 karakter")
    .regex(/^[A-Za-z0-9._-]+$/, "NIS hanya boleh berisi huruf, angka, titik, atau tanda hubung"),
  nisn: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || /^\d{10}$/.test(val), {
      message: "NISN harus terdiri dari tepat 10 digit angka",
    })
    .transform((val) => (val && val.length > 0 ? val : null)),
  gender: z.enum(["L", "P"]).optional().nullable(),
  phone: optionalTrimmedString(30),
  guardianName: optionalTrimmedString(120),
  guardianPhone: optionalTrimmedString(30),
  classId: z.string().uuid("ID kelas tidak valid").optional().nullable(),
  isActive: z.boolean(),
});

export const createTeacherSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap guru minimal 2 karakter")
    .max(120, "Nama lengkap maksimal 120 karakter"),
  email: z
    .string()
    .trim()
    .email("Format email guru tidak valid")
    .max(254, "Email terlalu panjang"),
  initialPassword: z
    .string()
    .min(8, "Kata sandi awal minimal 8 karakter")
    .max(128, "Kata sandi maksimal 128 karakter"),
  nip: optionalTrimmedString(30),
  specialization: optionalTrimmedString(120),
  employmentStatus: z.enum(["ASN", "PPPK", "GTY", "GTT", "HONORER", "LAINNYA"]).default("GTY"),
  phone: optionalTrimmedString(30),
});

export const updateTeacherSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Nama lengkap guru minimal 2 karakter")
    .max(120, "Nama lengkap maksimal 120 karakter"),
  nip: optionalTrimmedString(30),
  specialization: optionalTrimmedString(120),
  employmentStatus: z.enum(["ASN", "PPPK", "GTY", "GTT", "HONORER", "LAINNYA"]),
  phone: optionalTrimmedString(30),
  isActive: z.boolean(),
});

export const createTeacherAssignmentSchema = z.object({
  teacherId: z.string().uuid("Guru wajib dipilih"),
  classId: z.string().uuid("Kelas wajib dipilih"),
  subjectId: z.string().uuid("Mata pelajaran wajib dipilih"),
  academicYearId: z.string().uuid("Tahun ajaran wajib dipilih"),
});

export const createAcademicYearSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^\d{4}\/\d{4}$/, "Format tahun ajaran harus YYYY/YYYY (contoh: 2026/2027)"),
    semester: z.enum(["Ganjil", "Genap", "Tahunan"]),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal mulai tidak valid"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal selesai tidak valid"),
    isActive: z.boolean().default(false),
  })
  .refine((val) => val.endsOn > val.startsOn, {
    message: "Tanggal selesai harus lebih lambat daripada tanggal mulai",
    path: ["endsOn"],
  });

export const createClassSchema = z.object({
  academicYearId: z.string().uuid("Tahun ajaran wajib dipilih"),
  name: z
    .string()
    .trim()
    .min(2, "Nama kelas minimal 2 karakter")
    .max(60, "Nama kelas maksimal 60 karakter"),
  gradeLevel: z
    .string()
    .trim()
    .min(1, "Tingkat kelas wajib diisi")
    .max(20, "Tingkat kelas maksimal 20 karakter"),
  program: optionalTrimmedString(60),
  homeroomTeacherId: z.string().uuid("ID wali kelas tidak valid").optional().nullable(),
  capacity: z.coerce
    .number()
    .int("Kapasitas harus berupa bilangan bulat")
    .min(1, "Kapasitas minimal 1 siswa")
    .max(100, "Kapasitas maksimal 100 siswa")
    .optional()
    .nullable(),
});

export const updateClassSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama kelas minimal 2 karakter")
    .max(60, "Nama kelas maksimal 60 karakter"),
  gradeLevel: z
    .string()
    .trim()
    .min(1, "Tingkat kelas wajib diisi")
    .max(20, "Tingkat kelas maksimal 20 karakter"),
  program: optionalTrimmedString(60),
  homeroomTeacherId: z.string().uuid("ID wali kelas tidak valid").optional().nullable(),
  capacity: z.coerce
    .number()
    .int("Kapasitas harus berupa bilangan bulat")
    .min(1, "Kapasitas minimal 1 siswa")
    .max(100, "Kapasitas maksimal 100 siswa")
    .optional()
    .nullable(),
  isActive: z.boolean(),
});

export const createSubjectSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Kode mata pelajaran minimal 2 karakter")
    .max(24, "Kode maksimal 24 karakter")
    .regex(/^[A-Za-z0-9_-]+$/, "Kode hanya boleh berisi huruf, angka, garis bawah, atau tanda hubung")
    .transform((v) => v.toUpperCase()),
  name: z
    .string()
    .trim()
    .min(2, "Nama mata pelajaran minimal 2 karakter")
    .max(120, "Nama mata pelajaran maksimal 120 karakter"),
  curriculumGroup: z
    .string()
    .trim()
    .min(2, "Kelompok kurikulum minimal 2 karakter")
    .max(60, "Kelompok kurikulum maksimal 60 karakter")
    .default("Wajib"),
  description: optionalTrimmedString(300),
});

export const updateSubjectSchema = createSubjectSchema.extend({
  isActive: z.boolean(),
});

export const updateSchoolSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama sekolah minimal 3 karakter")
    .max(160, "Nama sekolah maksimal 160 karakter"),
  npsn: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || /^\d{8}$/.test(val), {
      message: "NPSN harus terdiri dari 8 digit angka",
    })
    .transform((val) => (val && val.length > 0 ? val : null)),
  level: z.enum(["SD", "SMP", "SMA", "SMK", "OTHER"]),
  address: optionalTrimmedString(250),
  phone: optionalTrimmedString(30),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: "Format email sekolah tidak valid",
    })
    .transform((val) => (val && val.length > 0 ? val : null)),
  timezone: z.enum(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]),
  academicCalendarNote: optionalTrimmedString(300),
  resultReleasePolicy: z.enum([
    "manual_review",
    "scheduled_release",
    "immediate_after_close",
  ]),
  requireExamBrowserInHighStakes: z.boolean(),
  allowLateJoinMinutes: z.coerce.number().int().min(0).max(60),
  heartbeatIntervalSeconds: z.coerce.number().int().min(10).max(120),
});
