import { z } from "zod";

export const questionOptionInputSchema = z.object({
  optionKey: z.string().trim().min(1, "Kode opsi wajib diisi").max(10),
  optionText: z.string().trim().min(1, "Teks opsi wajib diisi").max(2000),
  displayOrder: z.number().int().min(0).max(20),
});

export const upsertQuestionSchema = z.object({
  questionBankId: z.string().uuid("Bank soal wajib dipilih").optional(),
  subjectId: z.string().uuid("Mata pelajaran wajib dipilih"),
  questionType: z.enum(["single_choice", "multiple_choice", "true_false", "essay"]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  topic: z
    .string()
    .trim()
    .max(120, "Topik maksimal 120 karakter")
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(12, "Maksimal 12 tag")
    .default([]),
  status: z.enum(["draft", "active", "archived"]).default("active"),
  stem: z
    .string()
    .trim()
    .min(3, "Pertanyaan minimal 3 karakter")
    .max(10_000, "Pertanyaan terlalu panjang"),
  explanation: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  points: z.coerce
    .number()
    .positive("Poin harus lebih dari 0")
    .max(1000, "Poin maksimal 1000"),
  scoringPolicy: z
    .enum(["exact_match", "partial_credit_disabled", "manual_rubric"])
    .default("exact_match"),
  rubricNotes: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  preserveOptionOrder: z.boolean().default(false),
  options: z.array(questionOptionInputSchema).max(8).default([]),
  correctOptionKeys: z.array(z.string().trim().min(1).max(10)).default([]),
});

export const createExamSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Judul ujian minimal 3 karakter")
    .max(180, "Judul ujian maksimal 180 karakter"),
  subjectId: z.string().uuid("Mata pelajaran wajib dipilih"),
  academicYearId: z.string().uuid("Tahun ajaran wajib dipilih"),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  instructions: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  durationMinutes: z.coerce
    .number()
    .int("Durasi harus berupa bilangan bulat menit")
    .min(1, "Durasi minimal 1 menit")
    .max(480, "Durasi maksimal 480 menit"),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(1),
  passingScore: z.coerce.number().min(0, "Nilai ketuntasan tidak boleh negatif").default(70),
  randomizeQuestions: z.boolean().default(false),
  randomizeOptions: z.boolean().default(false),
  resultReleasePolicy: z
    .enum(["manual", "after_submit_if_no_essay", "after_window_close"])
    .default("manual"),
  allowStudentReview: z.boolean().default(false),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  classIds: z.array(z.string().uuid()).default([]),
});

export const updateExamSchema = createExamSchema.extend({
  versionLock: z.coerce.number().int().min(1),
});

export const updateExamDraftQuestionsSchema = z.object({
  versionLock: z.coerce.number().int().min(1),
  items: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        pointsOverride: z.coerce.number().positive().max(1000).optional().nullable(),
        preserveOrder: z.boolean().default(false),
      })
    )
    .max(250, "Maksimal 250 soal dalam satu ujian"),
});

export const updateExamScheduleSchema = z.object({
  versionLock: z.coerce.number().int().min(1),
  startsAt: z.string().datetime({ offset: true, message: "Format waktu mulai tidak valid" }),
  endsAt: z.string().datetime({ offset: true, message: "Format waktu selesai tidak valid" }),
  durationMinutes: z.coerce.number().int().min(1).max(480),
  maxAttempts: z.coerce.number().int().min(1).max(10),
  lateJoinMinutes: z.coerce.number().int().min(0).max(120).default(15),
  requireExamBrowser: z.boolean().default(true),
  classIds: z.array(z.string().uuid()).min(1, "Pilih minimal 1 kelas peserta"),
});

export const publishExamSchema = z.object({
  versionLock: z.coerce.number().int().min(1),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const examStatusTransitionSchema = z.object({
  versionLock: z.coerce.number().int().min(1),
  targetStatus: z.enum(["DRAFT", "READY_FOR_REVIEW", "CLOSED", "ARCHIVED"]),
  notes: z.string().trim().max(500).optional().nullable(),
});
