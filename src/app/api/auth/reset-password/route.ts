import { NextResponse } from "next/server";
import { enforceApiRateLimit, parseJsonBody } from "@/lib/api-helpers";
import { getPublicEnvStatus } from "@/lib/env";
import { mapAuthErrorToSafeMessage } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/schemas/auth";

export async function POST(request: Request) {
  const rateBlocked = enforceApiRateLimit(request, "auth:reset-password", 8, 10 * 60_000);
  if (rateBlocked) return rateBlocked;

  if (!getPublicEnvStatus().configured) {
    return NextResponse.json(
      { error: "Konfigurasi autentikasi belum tersedia.", code: "SUPABASE_UNCONFIGURED" },
      { status: 503 }
    );
  }

  const rawBody = await parseJsonBody(request);
  const parsed = resetPasswordSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Kata sandi baru tidak memenuhi syarat.",
        code: "VALIDATION_ERROR",
      },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json(
      {
        error: "Sesi pemulihan tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru.",
        code: "SESSION_INVALID",
      },
      { status: 401 }
    );
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (updateErr) {
    return NextResponse.json(
      {
        error: mapAuthErrorToSafeMessage(updateErr.message),
        code: "PASSWORD_UPDATE_FAILED",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Kata sandi berhasil diperbarui. Anda dapat melanjutkan ke dasbor.",
  });
}
