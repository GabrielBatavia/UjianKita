"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { resetPasswordSchema } from "@/schemas/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Kata sandi baru tidak valid.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? "Gagal memperbarui kata sandi.");
        return;
      }

      setSuccessMessage(data.message ?? "Kata sandi berhasil diperbarui.");
      setTimeout(() => {
        router.push("/dashboard");
        router.refresh();
      }, 1200);
    } catch {
      setErrorMessage("Terjadi kendala koneksi saat memperbarui kata sandi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {errorMessage ? (
        <Alert variant="danger" title="Gagal Memperbarui Kata Sandi">
          {errorMessage}
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert variant="success" title="Berhasil">
          {successMessage}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="new-password">Kata Sandi Baru</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          placeholder="Minimal 8 karakter, kombinasi huruf & angka"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Konfirmasi Kata Sandi Baru</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="Ulangi kata sandi baru"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
          required
        />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Menyimpan...</span>
          </>
        ) : (
          <>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span>Simpan Kata Sandi Baru</span>
          </>
        )}
      </Button>
    </form>
  );
}
