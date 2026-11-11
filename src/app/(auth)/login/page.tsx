import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPublicEnvStatus } from "@/lib/env";
import { sanitizeInternalRedirectPath } from "@/lib/security";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/features/auth/login-form";

export const metadata: Metadata = {
  title: "Masuk Portal",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const envStatus = getPublicEnvStatus();
  const nextPath = params.next ? sanitizeInternalRedirectPath(params.next, "/dashboard") : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <BrandLogo href="/" />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Beranda</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Masuk ke UjianKita</CardTitle>
              <CardDescription>
                Gunakan akun sekolah resmi Anda (Administrator, Guru, atau Siswa).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm
                supabaseConfigured={envStatus.configured}
                nextPath={nextPath}
                initialReason={params.reason ?? null}
              />
            </CardContent>
          </Card>

          <p className="text-center text-xs text-slate-500 leading-relaxed">
            Pendaftaran mandiri dinonaktifkan demi keamanan ujian. Hubungi administrator sekolah
            apabila Anda belum memiliki akun.
          </p>
        </div>
      </main>
    </div>
  );
}
