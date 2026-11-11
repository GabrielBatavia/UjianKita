"use client";

import * as React from "react";
import { Loader2, Mail } from "lucide-react";
import { forgotPasswordSchema } from "@/schemas/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm({ supabaseConfigured }: { supabaseConfigured: boolean }) {
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Format email tidak valid.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.email }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok) {
        setErrorMessage(data.error ?? "Permintaan pengaturan ulang gagal diproses.");
        return;
      }

      setSuccessMessage(
        data.message ??
          "Jika email terdaftar di sekolah Anda, tautan pengaturan ulang kata sandi telah dikirim."
      );
      setEmail("");
    } catch {
      setErrorMessage("Gagal menghubungi server. Silakan coba beberapa saat lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {!supabaseConfigured ? (
        <Alert variant="warning" title="Konfigurasi Belum Aktif">
          Layanan pemulihan kata sandi memerlukan konfigurasi Supabase Auth terlebih dahulu.
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="danger" title="Permintaan Ditolak">
          {errorMessage}
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert variant="success" title="Periksa Kotak Masuk Anda">
          {successMessage}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email Terdaftar</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="nama@sekolah.sch.id"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting || !supabaseConfigured}
          required
        />
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
            <span>Mengirim Tautan...</span>
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" aria-hidden="true" />
            <span>Kirim Tautan Pemulihan</span>
          </>
        )}
      </Button>
    </form>
  );
}
