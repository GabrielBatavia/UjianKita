import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnvStatus } from "@/lib/env";
import { sanitizeInternalRedirectPath } from "@/lib/security";

const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/teacher", "/student"];
const AUTH_PAGES = ["/login", "/forgot-password"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isAuthPagePath(pathname: string): boolean {
  return AUTH_PAGES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // Block dev preview in production unless explicitly enabled
  if (pathname === "/dev-preview" || pathname.startsWith("/dev-preview/")) {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PREVIEW !== "true") {
      return new NextResponse(null, { status: 404 });
    }
  }

  const envStatus = getPublicEnvStatus();

  // Fail closed on protected portal routes if Supabase is not configured yet
  if (!envStatus.configured || !envStatus.supabaseUrl || !envStatus.supabaseAnonKey) {
    if (isProtectedPath(pathname)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("reason", "unconfigured");
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(envStatus.supabaseUrl, envStatus.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // Always verify session via auth.getUser(), never auth.getSession()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const isAuthenticated = Boolean(user && !error);

  if (!isAuthenticated && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const intended = sanitizeInternalRedirectPath(pathname + request.nextUrl.search, "/dashboard");
    loginUrl.searchParams.set("next", intended);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && isAuthPagePath(pathname)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}
