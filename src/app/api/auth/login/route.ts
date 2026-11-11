import { NextResponse } from "next/server";
import { enforceApiRateLimit, parseJsonBody, buildAuditContext } from "@/lib/api-helpers";
import { getPublicEnvStatus } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { mapAuthErrorToSafeMessage, sanitizeInternalRedirectPath } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDefaultPortalPath } from "@/policies/authorization";
import { recordAuditEvent } from "@/repositories/audit-repository";
import { loadAuthenticatedActor } from "@/repositories/auth-repository";
import { loginSchema } from "@/schemas/auth";

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "auth:login:ip", 15, 5 * 60_000);
  if (rateBlocked) return rateBlocked;

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
  const accountRate = checkRateLimit({
    key: `auth:login:email:${emailNormalized}`,
    limit: 8,
    windowMs: 5 * 60_000,
  });

  if (!accountRate.allowed) {
    return NextResponse.json(
      {
        error: "Terlalu banyak percobaan masuk untuk akun ini. Silakan tunggu beberapa menit.",
        code: "RATE_LIMITED",
      },
      { status: 429, headers: { "Retry-After": String(accountRate.retryAfterSeconds) } }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: emailNormalized,
    password: parsed.data.password,
  });

  if (signInError) {
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
    return NextResponse.json(
      {
        error: "Akun Anda belum aktif atau belum terhubung dengan profil sekolah.",
        code: "PROFILE_INACTIVE",
      },
      { status: 403 }
    );
  }

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
