import { z } from "zod";

export const startAttemptSchema = z.object({
  startIdempotencyKey: z.string().uuid().optional(),
  clientTimezone: z.string().trim().max(120).optional().nullable(),
});

export const studentResponsePayloadSchema = z.discriminatedUnion("questionType", [
  z.object({
    questionType: z.literal("single_choice"),
    selectedOptionKey: z.string().trim().min(1).max(16).nullable(),
  }),
  z.object({
    questionType: z.literal("true_false"),
    selectedOptionKey: z.string().trim().min(1).max(16).nullable(),
  }),
  z.object({
    questionType: z.literal("multiple_choice"),
    selectedOptionKeys: z
      .array(z.string().trim().min(1).max(16))
      .max(12, "Maksimal 12 opsi dapat dipilih"),
  }),
  z.object({
    questionType: z.literal("essay"),
    textAnswer: z.string().max(30_000, "Jawaban esai maksimal 30.000 karakter"),
  }),
]);

export const saveAnswerSchema = z.object({
  attemptQuestionId: z.string().uuid("ID soal sesi tidak valid"),
  idempotencyKey: z.string().uuid("Kunci idempotensi wajib berbentuk UUID"),
  clientRevision: z.coerce
    .number()
    .int("Revisi harus bilangan bulat")
    .min(1, "Revisi minimal 1")
    .max(1_000_000),
  responsePayload: studentResponsePayloadSchema,
  isFlaggedForReview: z.boolean().optional(),
});

export const toggleFlagSchema = z.object({
  attemptQuestionId: z.string().uuid("ID soal sesi tidak valid"),
  isFlaggedForReview: z.boolean(),
});

export const submitAttemptSchema = z.object({
  idempotencyKey: z.string().uuid("Kunci idempotensi pengumpulan wajib berbentuk UUID"),
  confirmedUnansweredAck: z.boolean().optional().default(true),
});

export const clientTelemetryEventSchema = z.object({
  eventType: z.enum([
    "PAGE_HIDDEN",
    "PAGE_VISIBLE",
    "RELOAD_RECOVERY",
    "CONNECTION_LOST",
    "CONNECTION_RESTORED",
    "STORAGE_WARNING",
    "COPY_PASTE_ATTEMPT",
    "EXIT_ATTEMPT",
  ]),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const manualEssayScoreEntrySchema = z.object({
  examVersionQuestionId: z.string().uuid("ID soal versi ujian tidak valid"),
  assignedScore: z.coerce
    .number()
    .min(0, "Nilai tidak boleh negatif")
    .max(1000, "Nilai melebihi batas"),
  feedback: z
    .string()
    .trim()
    .max(3000, "Catatan penilaian maksimal 3.000 karakter")
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const gradeEssayScoresSchema = z.object({
  entries: z
    .array(manualEssayScoreEntrySchema)
    .min(1, "Minimal satu soal esai harus dinilai")
    .max(100),
  releaseIfComplete: z.boolean().optional().default(false),
});

export const adjustGradeSchema = z.object({
  newTotalScore: z.coerce.number().min(0, "Nilai akhir tidak boleh negatif").max(10_000),
  reason: z
    .string()
    .trim()
    .min(5, "Alasan penyesuaian nilai minimal 5 karakter")
    .max(1000, "Alasan maksimal 1.000 karakter"),
});

export const releaseExamResultsSchema = z.object({
  action: z.enum(["release", "unpublish"]),
  allowStudentReview: z.boolean().optional(),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const cancelAttemptSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Alasan pembatalan minimal 5 karakter")
    .max(1000, "Alasan maksimal 1.000 karakter"),
});
