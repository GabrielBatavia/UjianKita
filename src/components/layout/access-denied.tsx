import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { Phase1RoleCode } from "@/domain/auth/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_NAMES: Record<Phase1RoleCode, string> = {
  admin: "Administrator Sekolah",
  teacher: "Guru",
  student: "Siswa",
};

export function AccessDenied({
  requiredRole,
  currentRole,
}: {
  requiredRole: Phase1RoleCode;
  currentRole: Phase1RoleCode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <Card className="w-full max-w-md border-red-200">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </div>
          <CardTitle>Akses Ditolak (403)</CardTitle>
          <CardDescription>
            Halaman ini hanya tersedia untuk peran <strong>{ROLE_NAMES[requiredRole]}</strong>. Akun
            Anda saat ini masuk sebagai <strong>{ROLE_NAMES[currentRole]}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild>
            <Link href={`/${currentRole}`}>Kembali ke Dasbor Saya</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
