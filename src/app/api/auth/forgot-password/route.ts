import { NextResponse } from "next/server";
import { enforceApiRateLimit, parseJsonBody } from "@/lib/api-helpers";
import { getAppUrl, getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { forgotPasswordSchema } from "@/schemas/auth";

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "auth:forgot-password", 6, 10 * 60_000);
  if (rateBlocked) return rateBlocked;

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

  const supabase = await createSupabaseServerClient();
  const redirectTo = `${getAppUrl()}/auth/callback?next=/reset-password`;

  // Always return a generic success response to avoid email enumeration
  await supabase.auth.resetPasswordForEmail(parsed.data.email.toLowerCase(), {
    redirectTo,
  });

  return NextResponse.json({
    ok: true,
    message:
      "Jika email tersebut terdaftar di sekolah Anda, tautan pengaturan ulang kata sandi telah dikirim.",
  });
}
