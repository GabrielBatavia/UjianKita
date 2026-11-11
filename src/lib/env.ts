import { publicSupabaseEnvSchema, serverSupabaseEnvSchema } from "@/schemas/env";

export interface PublicEnvStatus {
  configured: boolean;
  serviceRoleConfigured: boolean;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  appUrl: string;
  validationErrors: string[];
}

export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export function getPublicEnvStatus(): PublicEnvStatus {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const rawService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const parsed = publicSupabaseEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: rawUrl ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: rawAnon ?? "",
  });

  const serviceRoleConfigured = Boolean(rawService && rawService.trim().length >= 20);

  if (!parsed.success) {
    return {
      configured: false,
      serviceRoleConfigured,
      supabaseUrl: null,
      supabaseAnonKey: null,
      appUrl: getAppUrl(),
      validationErrors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  return {
    configured: true,
    serviceRoleConfigured,
    supabaseUrl: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    appUrl: getAppUrl(),
    validationErrors: [],
  };
}

export function requirePublicSupabaseEnv(): { url: string; anonKey: string } {
  const parsed = publicSupabaseEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  });

  if (!parsed.success) {
    throw new Error(
      `Konfigurasi Supabase belum lengkap: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function requireServiceRoleEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
} {
  if (typeof window !== "undefined") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY tidak boleh diakses di browser.");
  }

  const parsed = serverSupabaseEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  });

  if (!parsed.success) {
    throw new Error(
      `Konfigurasi server Supabase belum lengkap: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  };
}
