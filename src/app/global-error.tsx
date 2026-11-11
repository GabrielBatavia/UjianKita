"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center text-slate-900">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold">Gangguan Sistem UjianKita</h1>
          <p className="mt-2 text-sm text-slate-600">
            Terjadi gangguan tak terduga pada aplikasi. Silakan muat ulang atau hubungi administrator
            sekolah Anda.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 inline-flex min-h-[42px] items-center justify-center rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Muat Ulang Aplikasi
          </button>
        </div>
      </body>
    </html>
  );
}
