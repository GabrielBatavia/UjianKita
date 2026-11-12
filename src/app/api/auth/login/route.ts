import { NextResponse } from "next/server";
import {
  buildAuditContext,
  buildRateLimitResponse,
  enforceDistributedIpRateLimit,
  parseJsonBody,
} from "@/lib/api-helpers";
import { getPublicEnvStatus } from "@/lib/env";
import {
  checkDistributedRateLimit,
  hashRateLimitIdentifier,
  resetDistributedRateLimit,
} from "@/lib/rate-limit";
import { mapAuthErrorToSafeMessage, sanitizeInternalRedirectPath } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDefaultPortalPath } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import { loadAuthenticatedActor } from "@/repositories/auth-repository";
import { loginSchema } from "@/schemas/auth";

// Limits tuned for ~100-200 students sharing one school Wi-Fi NAT IP while still
// stopping credential-stuffing and single-account brute-force attacks globally.
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_IP_TOTAL_BURST_LIMIT = 300;
const LOGIN_IP_FAILURE_LIMIT = 25;
const LOGIN_EMAIL_FAILURE_LIMIT = 8;
const LOGIN_EMAIL_BURST_LIMIT = 20;

export async function POST(request: Request) {
  const { blocked: burstBlocked, ipKeyHash } = await enforceDistributedIpRateLimit({
    request,
    scope: "auth:login:burst",
    limit: LOGIN_IP_TOTAL_BURST_LIMIT,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (burstBlocked) return burstBlocked;

  const envStatus = getPublicEnvStatus();
  if (!envStatus.configured) {
    return NextResponse.json(
      {
        error:
          "Layanan autentikasi Supabase belum dikonfigurasi pada lingkungan ini. Hubungi administrator sistem.",
        code: "SUPABASE_UNCONFIGURED",
      },
      { status: 503 }
    );
  }

  const rawBody = await parseJsonBody(request);
  const parsed = loginSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Email dan kata sandi wajib diisi dengan benar.",
        code: "VALIDATION_ERROR",
      },
      { status: 400 }
    );
  }

  const emailNormalized = parsed.data.email.toLowerCase();
  const emailHash = hashRateLimitIdentifier(emailNormalized);
  const failIpKey = `auth:login:fail:ip:${ipKeyHash}`;
  const failEmailKey = `auth:login:fail:email:${emailHash}`;
  const burstEmailKey = `auth:login:burst:email:${emailHash}`;

  const [ipFailCheck, emailFailCheck, emailBurstCheck] = await Promise.all([
    checkDistributedRateLimit({
      key: failIpKey,
      limit: LOGIN_IP_FAILURE_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      increment: false,
    }),
    checkDistributedRateLimit({
      key: failEmailKey,
      limit: LOGIN_EMAIL_FAILURE_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      increment: false,
    }),
    checkDistributedRateLimit({
      key: burstEmailKey,
      limit: LOGIN_EMAIL_BURST_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      increment: true,
    }),
  ]);

  if (!ipFailCheck.allowed) {
    return buildRateLimitResponse(
      ipFailCheck.retryAfterSeconds,
      "Terlalu banyak percobaan login gagal dari jaringan ini. Silakan tunggu beberapa menit."
    );
  }

  if (!emailFailCheck.allowed || !emailBurstCheck.allowed) {
    const retryAfter = Math.max(emailFailCheck.retryAfterSeconds, emailBurstCheck.retryAfterSeconds);
    return buildRateLimitResponse(
      retryAfter,
      "Terlalu banyak percobaan masuk untuk akun ini. Silakan tunggu beberapa menit."
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: emailNormalized,
    password: parsed.data.password,
  });

  if (signInError) {
    await Promise.all([
      checkDistributedRateLimit({
        key: failIpKey,
        limit: LOGIN_IP_FAILURE_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
        increment: true,
      }),
      checkDistributedRateLimit({
        key: failEmailKey,
        limit: LOGIN_EMAIL_FAILURE_LIMIT,
        windowMs: LOGIN_WINDOW_MS,
        increment: true,
      }),
    ]);

    return NextResponse.json(
      {
        error: mapAuthErrorToSafeMessage(signInError.message),
        code: "AUTH_FAILED",
      },
      { status: 401 }
    );
  }

  const actor = await loadAuthenticatedActor(supabase);
  if (!actor) {
    await supabase.auth.signOut();
    await checkDistributedRateLimit({
      key: failEmailKey,
      limit: LOGIN_EMAIL_FAILURE_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      increment: true,
    });
    return NextResponse.json(
      {
        error: "Akun Anda belum aktif atau belum terhubung dengan profil sekolah.",
        code: "PROFILE_INACTIVE",
      },
      { status: 403 }
    );
  }

  await resetDistributedRateLimit(failEmailKey);

  const auditCtx = buildAuditContext(request);
  await recordAuditEvent(supabase, {
    schoolId: actor.schoolId,
    actorUserId: actor.userId,
    actorRole: actor.primaryRole,
    action: "auth.login_success",
    entityType: "session",
    entityId: actor.userId,
    summary: `${actor.fullName} berhasil masuk sebagai ${actor.primaryRole}`,
    ipAddress: auditCtx.ipAddress,
    userAgent: auditCtx.userAgent,
  });

  const nextCandidate =
    rawBody && typeof rawBody === "object" && "next" in rawBody && typeof rawBody.next === "string"
      ? rawBody.next
      : null;

  const defaultPath = getDefaultPortalPath(actor.roles);
  const safeNext = nextCandidate
    ? sanitizeInternalRedirectPath(nextCandidate, defaultPath)
    : defaultPath;

  return NextResponse.json({
    ok: true,
    role: actor.primaryRole,
    redirectTo: safeNext === "/dashboard" ? defaultPath : safeNext,
  });
}
