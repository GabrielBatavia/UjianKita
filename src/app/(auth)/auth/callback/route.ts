import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnvStatus } from "@/lib/env";
import { sanitizeInternalRedirectPath } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeInternalRedirectPath(searchParams.get("next"), "/dashboard");

  if (!getPublicEnvStatus().configured || !code) {
    return NextResponse.redirect(new URL("/login?reason=callback_invalid", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?reason=callback_expired", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
