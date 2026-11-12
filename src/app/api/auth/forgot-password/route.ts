import { NextResponse } from "next/server";
import {
  buildRateLimitResponse,
  enforceDistributedIpRateLimit,
  parseJsonBody,
} from "@/lib/api-helpers";
import { getAppUrl, getPublicEnvStatus } from "@/lib/env";
import { checkDistributedRateLimit, hashRateLimitIdentifier } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/schemas/auth";

export async function POST(request: Request) {
  const { blocked: ipBlocked } = await enforceDistributedIpRateLimit({
    request,
    scope: "auth:forgot-password",
    limit: 30,
    windowMs: 10 * 60_000,
  });
  if (ipBlocked) return ipBlocked;

  const envStatus = getPublicEnvStatus();
  if (!envStatus.configured) {
    return NextResponse.json(
      {
        error: "Layanan pemulihan kata sandi belum tersedia karena Supabase belum dikonfigurasi.",
        code: "SUPABASE_UNCONFIGURED",
      },
      { status: 503 }
    );
  }

  const rawBody = await parseJsonBody(request);
  const parsed = forgotPasswordSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Format email tidak valid.",
        code: "VALIDATION_ERROR",
      },
      { status: 400 }
    );
  }

  const emailNormalized = parsed.data.email.toLowerCase();
  const emailLimit = await checkDistributedRateLimit({
    key: `auth:forgot-password:email:${hashRateLimitIdentifier(emailNormalized)}`,
    limit: 4,
    windowMs: 10 * 60_000,
  });
  if (!emailLimit.allowed) {
    return buildRateLimitResponse(emailLimit.retryAfterSeconds);
  }

  const supabase = await createSupabaseServerClient();
  const redirectTo = `${getAppUrl()}/auth/callback?next=/reset-password`;

  // Always return a generic success response to avoid email enumeration
  await supabase.auth.resetPasswordForEmail(emailNormalized, {
    redirectTo,
  });

  return NextResponse.json({
    ok: true,
    message:
      "Jika email tersebut terdaftar di sekolah Anda, tautan pengaturan ulang kata sandi telah dikirim.",
  });
}
