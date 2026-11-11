import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/features/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Atur Ulang Kata Sandi",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <BrandLogo href="/" />
          <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Halaman Masuk
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Tetapkan Kata Sandi Baru</CardTitle>
            <CardDescription>
              Gunakan kata sandi yang kuat dan belum pernah dipakai sebelumnya.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
