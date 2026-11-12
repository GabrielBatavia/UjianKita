import { z } from "zod";
import { telemetryMetadataSchema } from "@/schemas/attempts";

export const browserEnforcementPolicySchema = z.enum([
  "STANDARD_BROWSER_ALLOWED",
  "SECURE_BROWSER_RECOMMENDED",
  "VERIFIED_SEB_REQUIRED",
]);

export const monitoringBrowserPlatformSchema = z.enum([
  "STANDARD_WEB",
  "ANDROID_EXAMBRO",
  "IOS_SAFE_EXAM_BROWSER",
  "UNKNOWN",
]);

export const studentClientReportedEventTypeSchema = z.enum([
  "EXAM_PAGE_VISIBLE",
  "EXAM_PAGE_HIDDEN",
  "EXAM_PAGE_RELOADED",
  "EXAM_PAGE_NAVIGATION_OBSERVED",
  "CONNECTION_RESTORED",
  "COPY_EVENT_OBSERVED",
  "PASTE_EVENT_OBSERVED",
  "CONTEXT_MENU_EVENT_OBSERVED",
  "EXAMBRO_HINT_REPORTED",
  // Legacy Phase 3 values supported cleanly
  "PAGE_HIDDEN",
  "PAGE_VISIBLE",
  "RELOAD_RECOVERY",
  "CONNECTION_LOST",
  "STORAGE_WARNING",
  "COPY_PASTE_ATTEMPT",
  "EXIT_ATTEMPT",
]);

export const singleMonitoringEventSchema = z.object({
  clientEventId: z.string().trim().min(4).max(100),
  eventType: studentClientReportedEventTypeSchema,
  occurredAt: z.string().datetime().optional(),
  metadata: telemetryMetadataSchema,
});

export const batchedMonitoringEventsSchema = z.object({
  events: z
    .array(singleMonitoringEventSchema)
    .min(1, "Minimal 1 event diperlukan.")
    .max(25, "Maksimal 25 event per batch."),
});

export const heartbeatRequestSchema = z.object({
  clientRevision: z.number().int().min(0).optional(),
  visible: z.boolean().optional().default(true),
  online: z.boolean().optional().default(true),
  queuedAnswerCount: z.number().int().min(0).max(500).optional().default(0),
  browserPlatformHint: monitoringBrowserPlatformSchema.optional(),
  exambroHint: z.boolean().optional().default(false),
  clientTimestamp: z.string().datetime().optional(),
});

export const sebVerifyRequestSchema = z.object({
  pageUrl: z.string().url("URL halaman verifikasi SEB harus berupa URL valid.").max(1000),
  configKeyHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "ConfigKeyHash SEB harus berupa 64 karakter hex SHA-256.")
    .optional()
    .nullable(),
  browserExamKeyHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "BrowserExamKeyHash SEB harus berupa 64 karakter hex SHA-256.")
    .optional()
    .nullable(),
  sebVersion: z.string().trim().max(64).optional().nullable(),
});

export const startAttemptSecurityContextSchema = z.object({
  browserPlatformHint: monitoringBrowserPlatformSchema.optional(),
  exambroHint: z.boolean().optional().default(false),
  sebPageUrl: z.string().url().max(1000).optional(),
  sebConfigKeyHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  sebBrowserExamKeyHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

const optionalHexHashSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, "Kunci SHA-256 harus tepat 64 karakter heksadesimal.")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

export const updateExamSecurityPolicySchema = z
  .object({
    browserPolicy: browserEnforcementPolicySchema,
    exambroEnabled: z.boolean(),
    exambroMinAppHint: z.string().trim().max(80).nullable().optional(),
    sebEnabled: z.boolean(),
    sebConfigKeyHash: optionalHexHashSchema,
    sebBrowserExamKeyHash: optionalHexHashSchema,
    generateSebProfileKey: z.boolean().optional().default(false),
    sebAllowStandardWithOverride: z.boolean().default(true),
    copyPasteGuardEnabled: z.boolean(),
    contextMenuGuardEnabled: z.boolean(),
    watermarkEnabled: z.boolean(),
    watermarkOpacity: z.number().min(0.03).max(0.18),
    heartbeatIntervalSeconds: z.number().int().min(15).max(120),
    staleThresholdSeconds: z.number().int().min(45).max(300),
    visibilitySwitchWarnThreshold: z.number().int().min(1).max(50),
    visibilitySwitchReviewThreshold: z.number().int().min(2).max(100),
    hiddenDurationReviewSeconds: z.number().int().min(15).max(1800),
    reloadWarnThreshold: z.number().int().min(1).max(50),
    reloadReviewThreshold: z.number().int().min(2).max(100),
    copyPasteReviewThreshold: z.number().int().min(1).max(50),
    privacyNoticeText: z.string().trim().min(20).max(1200),
  })
  .superRefine((val, ctx) => {
    if (val.staleThresholdSeconds < val.heartbeatIntervalSeconds * 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batas kedaluwarsa koneksi minimal dua kali interval heartbeat.",
        path: ["staleThresholdSeconds"],
      });
    }
    if (val.visibilitySwitchReviewThreshold < val.visibilitySwitchWarnThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ambang tinjauan pindah fokus harus >= ambang peringatan.",
        path: ["visibilitySwitchReviewThreshold"],
      });
    }
    if (val.reloadReviewThreshold < val.reloadWarnThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ambang tinjauan muat ulang harus >= ambang peringatan.",
        path: ["reloadReviewThreshold"],
      });
    }
  });

export const incidentStatusSchema = z.enum([
  "NEW",
  "UNDER_REVIEW",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
]);

export const updateIncidentStatusSchema = z.object({
  status: incidentStatusSchema,
  note: z
    .string()
    .trim()
    .min(3, "Catatan tinjauan minimal 3 karakter.")
    .max(1000, "Catatan tinjauan maksimal 1000 karakter."),
});

export const grantBrowserOverrideSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Alasan pengecualian peramban wajib diisi (minimal 5 karakter).")
    .max(500),
  durationMinutes: z.number().int().min(15).max(720).optional().default(240),
});

export const retentionCleanupSchema = z.object({
  daysToKeep: z.number().int().min(30, "Retensi minimal 30 hari.").max(1825),
  dryRun: z.boolean().optional().default(true),
});
