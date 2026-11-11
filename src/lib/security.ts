import type { NextRequest } from "next/server";

/**
 * Maps Supabase Auth errors or unknown server exceptions to safe, non-leaking
 * Indonesian user messages without disclosing whether an email exists.
 */
export function mapAuthErrorToSafeMessage(rawMessage?: string | null): string {
  const msg = (rawMessage ?? "").toLowerCase();

  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Terlalu banyak percobaan login. Silakan tunggu beberapa saat dan coba lagi.";
  }

  if (
    msg.includes("invalid login credentials") ||
    msg.includes("invalid_credentials") ||
    msg.includes("email not confirmed")
  ) {
    return "Email atau kata sandi tidak sesuai, atau akun belum aktif.";
  }

  if (msg.includes("session") || msg.includes("expired") || msg.includes("token")) {
    return "Sesi Anda telah berakhir atau tautan sudah tidak berlaku. Silakan masuk kembali.";
  }

  if (msg.includes("weak password") || msg.includes("password should be")) {
    return "Kata sandi baru belum memenuhi persyaratan keamanan minimal.";
  }

  return "Autentikasi gagal diproses. Silakan periksa kembali data Anda atau hubungi administrator sekolah.";
}

/**
 * Validates internal redirect paths to prevent open-redirect vulnerabilities.
 */
export function sanitizeInternalRedirectPath(candidate: string | null | undefined, fallback = "/dashboard"): string {
  if (!candidate) return fallback;
  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return fallback;
  }
  return trimmed;
}

export function extractClientIp(request: Pick<Request, "headers"> | NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

export function extractUserAgent(request: Pick<Request, "headers"> | NextRequest): string | null {
  const ua = request.headers.get("user-agent")?.trim();
  return ua ? ua.slice(0, 300) : null;
}
