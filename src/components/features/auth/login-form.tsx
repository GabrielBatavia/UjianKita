"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { loginSchema } from "@/schemas/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({
  supabaseConfigured,
  nextPath,
  initialReason,
}: {
  supabaseConfigured: boolean;
  nextPath: string | null;
  initialReason: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(
    initialReason === "callback_expired"
      ? "Tautan pemulihan sudah kedaluwarsa atau pernah digunakan. Silakan minta tautan baru."
      : initialReason === "callback_invalid"
        ? "Tautan verifikasi tidak valid."
        : null
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Periksa kembali email dan kata sandi.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: parsed.data.email,
          password: parsed.data.password,
          next: nextPath,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? "Gagal masuk ke UjianKita.");
        return;
      }

      router.push(data.redirectTo ?? "/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Koneksi ke server terganggu. Periksa jaringan internet Anda dan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {!supabaseConfigured ? (
        <Alert variant="warning" title="Konfigurasi Autentikasi Belum Aktif">
          Layanan autentikasi Supabase belum dikonfigurasi pada lingkungan ini. Hubungi administrator
          sistem untuk melengkapi variabel lingkungan sebelum masuk.
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="danger" title="Gagal Masuk">
          {errorMessage}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="login-email">Email Sekolah</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="nama@sekolah.sch.id"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting || !supabaseConfigured}
          required
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="login-password">Kata Sandi</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline"
          >
            Lupa kata sandi?
          </Link>
        </div>
        <div className="relative">
          <Input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Masukkan kata sandi"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting || !supabaseConfigured}
            className="pr-11"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={submitting || !supabaseConfigured}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Memverifikasi...</span>
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            <span>Masuk ke UjianKita</span>
          </>
        )}
      </Button>
    </form>
  );
}
