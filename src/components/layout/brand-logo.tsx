import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function BrandLogo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-2.5 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-white shadow-xs">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-base font-bold tracking-tight text-slate-900">UjianKita</span>
        <span className="text-[11px] font-medium text-slate-500">Platform CBT Sekolah</span>
      </span>
    </Link>
  );
}
