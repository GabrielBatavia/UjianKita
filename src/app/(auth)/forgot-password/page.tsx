import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPublicEnvStatus } from "@/lib/env";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/features/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Lupa Kata Sandi",
};

export default function ForgotPasswordPage() {
  const envStatus = getPublicEnvStatus();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <BrandLogo href="/" />
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Masuk</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Pulihkan Kata Sandi</CardTitle>
            <CardDescription>
              Masukkan alamat email sekolah Anda untuk menerima tautan pengaturan ulang kata sandi.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm supabaseConfigured={envStatus.configured} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
