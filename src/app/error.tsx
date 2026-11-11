"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[UjianKita ErrorBoundary]", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-900">Terjadi Kendala Saat Memuat Halaman</h1>
      <p className="mt-2 max-w-md text-sm text-slate-600 leading-relaxed">
        Sistem mengalami kesalahan saat memproses permintaan ini. Silakan muat ulang halaman atau
        kembali ke halaman utama.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-slate-500">Kode Referensi: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={reset}>
          Coba Lagi
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Ke Halaman Utama</Link>
        </Button>
      </div>
    </div>
  );
}
