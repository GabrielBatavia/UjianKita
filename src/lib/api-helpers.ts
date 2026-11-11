import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { extractClientIp, extractUserAgent } from "@/lib/security";
import { isServiceError } from "@/services/errors";
import type { RequestAuditContext } from "@/services/admin-service";

export function buildAuditContext(request: NextRequest | Request): RequestAuditContext {
  return {
    ipAddress: extractClientIp(request),
    userAgent: extractUserAgent(request),
  };
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function enforceApiRateLimit(
  request: Request,
  scope: string,
  limit = 60,
  windowMs = 60_000
): NextResponse | null {
  const ip = extractClientIp(request) ?? "unknown";
  const result = checkRateLimit({
    key: `${scope}:${ip}`,
    limit,
    windowMs,
  });

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: "Terlalu banyak permintaan dalam waktu singkat. Silakan coba beberapa saat lagi.",
        code: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
        },
      }
    );
  }
  return null;
}

export function handleApiError(error: unknown): NextResponse {
  if (isServiceError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.statusCode }
    );
  }

  console.error("[api] unhandled route error:", error);
  return NextResponse.json(
    {
      error: "Terjadi kesalahan pada layanan server. Silakan coba lagi.",
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
