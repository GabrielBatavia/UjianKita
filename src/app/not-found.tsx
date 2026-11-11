import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200/70 text-slate-700">
        <FileQuestion className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Halaman Tidak Ditemukan (404)</h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        Alamat yang Anda tuju tidak tersedia atau telah dipindahkan.
      </p>
      <div className="mt-6 flex gap-3">
        <Button asChild>
          <Link href="/">Kembali ke Beranda</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Masuk ke Portal</Link>
        </Button>
      </div>
    </div>
  );
}
