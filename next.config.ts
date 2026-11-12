import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const isLocalHttpApp =
  appUrl.startsWith("http://127.0.0.1") || appUrl.startsWith("http://localhost");
const allowHttpLocalhost = isDev || isLocalHttpApp;

function buildConfiguredSupabaseOrigins(): string[] {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) return [];
  try {
    const parsed = new URL(rawUrl);
    const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return [parsed.origin, `${wsProtocol}//${parsed.host}`];
  } catch {
    return [];
  }
}

const supabaseConnectTargets = Array.from(
  new Set([
    "https://*.supabase.co",
    "wss://*.supabase.co",
    ...buildConfiguredSupabaseOrigins(),
    ...(allowHttpLocalhost
      ? [
          "http://127.0.0.1:54321",
          "http://localhost:54321",
          "ws://127.0.0.1:54321",
          "ws://localhost:54321",
        ]
      : []),
  ])
);

const cspDirectives = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseConnectTargets.join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(allowHttpLocalhost ? [] : ["upgrade-insecure-requests"]),
];

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
  ...(allowHttpLocalhost
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    cpus: Number(process.env.NEXT_BUILD_CPUS || 2),
    memoryBasedWorkersCount: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
