"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Info,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import {
  EXAMBRO_GOOGLE_PLAY_URL,
  generateQrCodeSvg,
} from "@/domain/monitoring/exambro-compat";
import type { StudentSecurityPolicyView } from "@/domain/monitoring/phase4-types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function StudentExamSecurityCard({
  policy,
  sebStatus,
  onRetrySebVerify,
  verifyingSeb,
}: {
  policy: StudentSecurityPolicyView;
  sebStatus: {
    apiDetected: boolean;
    verified: boolean;
    detail: string | null;
  };
  onRetrySebVerify: () => void;
  verifyingSeb: boolean;
}) {
  const [copiedUrl, setCopiedUrl] = React.useState(false);
  const [examUrl, setExamUrl] = React.useState("");

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (typeof window !== "undefined") {
        setExamUrl(`${window.location.origin}/student/exams/${policy.examId}`);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [policy.examId]);

  const qrSvg = React.useMemo(() => {
    if (!policy.exambroEnabled || !examUrl) return null;
    try {
      return generateQrCodeSvg(examUrl, {
        sizePx: 176,
        ariaLabel: `Kode QR ujian ${policy.examTitle} untuk aplikasi ExamBro`,
      });
    } catch {
      return null;
    }
  }, [policy.exambroEnabled, policy.examTitle, examUrl]);

  async function handleCopyUrl() {
    if (!examUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(examUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // Clipboard API may be blocked in restricted WebViews
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">
            Kebijakan Peramban &amp; Transparansi Pemantauan
          </h2>
        </div>

        {policy.hasActiveStaffOverride ? (
          <Badge variant="warning">Pengecualian Pengawas Aktif</Badge>
        ) : policy.browserPolicy === "VERIFIED_SEB_REQUIRED" ? (
          <Badge variant={sebStatus.verified ? "success" : "danger"}>
            {sebStatus.verified ? "Safe Exam Browser Terverifikasi" : "Wajib Safe Exam Browser"}
          </Badge>
        ) : policy.browserPolicy === "SECURE_BROWSER_RECOMMENDED" ? (
          <Badge variant="warning">Disarankan Peramban Aman</Badge>
        ) : (
          <Badge variant="neutral">Peramban Standar Diizinkan</Badge>
        )}
      </div>

      {/* Mandatory Bahasa Indonesia Privacy Notice */}
      <Alert variant="info" title="Pemberitahuan Privasi Pemantauan Ujian">
        <p className="text-xs leading-relaxed text-slate-700">{policy.privacyNoticeText}</p>
      </Alert>

      {policy.hasActiveStaffOverride && (
        <Alert variant="warning" title="Akses Pengecualian Darurat Aktif">
          <p className="text-xs">
            Pengawas telah mengizinkan Anda mengikuti ujian di peramban ini. Alasan:{" "}
            <strong>{policy.overrideReason ?? "Pengecualian resmi pengawas"}</strong>.
          </p>
        </Alert>
      )}

      {/* Safe Exam Browser Integration Panel */}
      {policy.sebEnabled && (
        <div className="space-y-3 rounded-lg border border-blue-200 bg-white p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Safe Exam Browser (iOS / iPadOS / Desktop SEB)
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                Unduh berkas konfigurasi <code>.seb</code> atau buka langsung di aplikasi Safe Exam
                Browser untuk verifikasi kriptografis kunci ujian.
              </p>
            </div>
            {sebStatus.verified ? (
              <Badge variant="success">
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                Kunci SEB Cocok
              </Badge>
            ) : policy.browserPolicy === "VERIFIED_SEB_REQUIRED" ? (
              <Badge variant="danger">
                <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />
                Menunggu Verifikasi SEB
              </Badge>
            ) : null}
          </div>

          {sebStatus.detail && (
            <p className="rounded bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
              {sebStatus.detail}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={policy.sebConfigDownloadUrl} download>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Unduh Konfigurasi (.seb)</span>
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={policy.sebLaunchUrl}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Buka di Safe Exam Browser</span>
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={verifyingSeb}
              onClick={onRetrySebVerify}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${verifyingSeb ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>{verifyingSeb ? "Memverifikasi..." : "Verifikasi Kunci SEB"}</span>
            </Button>
          </div>
        </div>
      )}

      {/* Android ExamBro (com.dekikurnia.exambro) Compatibility Panel */}
      {policy.exambroEnabled && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <Smartphone className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <span>Panduan Android ExamBro</span>
              </p>
              <p className="text-xs text-slate-600">
                Untuk peserta pengguna Android, buka aplikasi <strong>ExamBro</strong> lalu pindai
                kode QR berikut atau tempel tautan ujian di kolom alamat aplikasi.
              </p>
            </div>
            <Badge variant="neutral">Petunjuk Klien (Non-Kriptografis)</Badge>
          </div>

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {qrSvg ? (
              <div
                className="shrink-0 rounded-lg border border-slate-200 bg-white p-2"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                <QrCode className="h-8 w-8" aria-hidden="true" />
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-2 text-xs">
              <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] break-all text-slate-800">
                {examUrl || `/student/exams/${policy.examId}`}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleCopyUrl}>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{copiedUrl ? "Tautan Disalin" : "Salin Tautan Ujian"}</span>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={EXAMBRO_GOOGLE_PLAY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Info Aplikasi ExamBro</span>
                  </a>
                </Button>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  ExamBro mengunci tampilan di perangkat Android secara lokal, namun tidak menyediakan
                  tanda tangan kriptografis server seperti Safe Exam Browser.
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
