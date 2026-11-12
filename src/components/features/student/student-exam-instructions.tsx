"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  PlayCircle,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import type { StudentExamAvailabilityItem } from "@/domain/exams/phase3-types";
import type { StudentSecurityPolicyView } from "@/domain/monitoring/phase4-types";
import { generateClientUuid, probeExamLocalStorageHealth } from "@/lib/exam-storage";
import { formatDateTimeId } from "@/lib/utils";
import { StudentExamSecurityCard } from "@/components/features/student/student-exam-security-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

declare global {
  interface Window {
    SafeExamBrowser?: {
      version?: string;
      security?: {
        updateKeys?: (
          callback: (configKey: string, browserExamKey: string) => void
        ) => void;
        configKey?: string;
        browserExamKey?: string;
      };
    };
  }
}

export function StudentExamInstructions({
  exam,
  timeZone,
  initialPolicy = null,
}: {
  exam: StudentExamAvailabilityItem;
  timeZone: string;
  initialPolicy?: StudentSecurityPolicyView | null;
}) {
  const router = useRouter();
  const [startKey] = React.useState(() => generateClientUuid());
  const [storageCheck, setStorageCheck] = React.useState<{
    checked: boolean;
    ok: boolean;
    warning: string | null;
  }>({ checked: false, ok: true, warning: null });
  const [networkState, setNetworkState] = React.useState<{
    online: boolean;
    latencyMs: number | null;
  }>({ online: true, latencyMs: null });
  const [securityPolicy, setSecurityPolicy] = React.useState<StudentSecurityPolicyView | null>(
    initialPolicy
  );
  const [sebProof, setSebProof] = React.useState<{
    pageUrl: string;
    configKeyHash: string | null;
    browserExamKeyHash: string | null;
  } | null>(null);
  const [sebStatus, setSebStatus] = React.useState<{
    apiDetected: boolean;
    verified: boolean;
    detail: string | null;
  }>({
    apiDetected: false,
    verified: Boolean(initialPolicy?.sebVerifiedForAttempt),
    detail: null,
  });
  const [verifyingSeb, setVerifyingSeb] = React.useState(false);
  const [acknowledgedRules, setAcknowledgedRules] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const runSebVerification = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    const sebApi = window.SafeExamBrowser?.security;
    if (!sebApi) {
      setSebStatus((prev) => ({
        ...prev,
        apiDetected: false,
        detail: "Objek JavaScript SafeExamBrowser tidak terdeteksi di peramban ini.",
      }));
      return;
    }

    setVerifyingSeb(true);
    const submitKeys = async (configKey: string | null, browserExamKey: string | null) => {
      const pageUrl = window.location.href.split("#")[0] ?? window.location.href;
      setSebProof({
        pageUrl,
        configKeyHash: configKey,
        browserExamKeyHash: browserExamKey,
      });

      try {
        const res = await fetch(`/api/student/exams/${exam.examId}/seb-verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageUrl,
            configKeyHash: configKey,
            browserExamKeyHash: browserExamKey,
            sebVersion: window.SafeExamBrowser?.version ?? null,
          }),
        });
        const data = (await res.json()) as { verified?: boolean; reason?: string };
        setSebStatus({
          apiDetected: true,
          verified: Boolean(res.ok && data.verified),
          detail: data.reason ?? (data.verified ? "Kunci SEB terverifikasi." : "Verifikasi kunci SEB gagal."),
        });
      } catch {
        setSebStatus({
          apiDetected: true,
          verified: false,
          detail: "Gagal menghubungi server untuk verifikasi kunci SEB.",
        });
      } finally {
        setVerifyingSeb(false);
      }
    };

    if (typeof sebApi.updateKeys === "function") {
      sebApi.updateKeys((cfgKey, bekKey) => {
        void submitKeys(cfgKey || null, bekKey || null);
      });
    } else {
      void submitKeys(sebApi.configKey ?? null, sebApi.browserExamKey ?? null);
    }
  }, [exam.examId]);

  React.useEffect(() => {
    let active = true;
    async function runPreflight() {
      const storage = await probeExamLocalStorageHealth();
      if (!active) return;
      setStorageCheck({
        checked: true,
        ok: storage.storageOk,
        warning: storage.warning,
      });

      const started = performance.now();
      try {
        const [examRes, policyRes] = await Promise.all([
          fetch(`/api/student/exams/${exam.examId}`, { cache: "no-store" }),
          fetch(`/api/student/exams/${exam.examId}/policy`, { cache: "no-store" }),
        ]);
        if (!active) return;
        setNetworkState({
          online: examRes.ok && navigator.onLine,
          latencyMs: Math.round(performance.now() - started),
        });
        if (policyRes.ok) {
          const pData = (await policyRes.json()) as StudentSecurityPolicyView;
          if (active) {
            setSecurityPolicy(pData);
            if (pData.sebVerifiedForAttempt) {
              setSebStatus({
                apiDetected: true,
                verified: true,
                detail: "Sesi aktif sudah terverifikasi menggunakan Safe Exam Browser.",
              });
            } else if (pData.sebEnabled && typeof window !== "undefined" && window.SafeExamBrowser?.security) {
              void runSebVerification();
            }
          }
        }
      } catch {
        if (!active) return;
        setNetworkState({ online: false, latencyMs: null });
      }
    }
    void runPreflight();
    return () => {
      active = false;
    };
  }, [exam.examId, runSebVerification]);

  async function handleStartExam() {
    if (starting) return;
    setErrorMsg(null);
    setStarting(true);

    try {
      const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? timeZone;
      const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
      const isExamBro = ua.includes("exambro") || ua.includes("dekikurnia");
      const res = await fetch(`/api/student/exams/${exam.examId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startIdempotencyKey: startKey,
          clientTimezone: clientTz,
          browserPlatformHint: isExamBro ? "ANDROID_EXAMBRO" : "STANDARD_WEB",
          exambroHint: isExamBro,
          ...(sebProof ? {
            sebPageUrl: sebProof.pageUrl,
            sebConfigKeyHash: sebProof.configKeyHash ?? undefined,
            sebBrowserExamKeyHash: sebProof.browserExamKeyHash ?? undefined,
          } : {}),
        }),
      });
      const data = (await res.json()) as {
        attemptId?: string;
        error?: string;
      };
      if (!res.ok || !data.attemptId) {
        setErrorMsg(data.error ?? "Gagal memulai sesi ujian.");
        setStarting(false);
        return;
      }

      router.push(`/student/attempts/${data.attemptId}`);
    } catch {
      setErrorMsg("Koneksi ke server terputus. Periksa jaringan lalu coba kembali.");
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/student/exams">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Daftar Ujian</span>
          </Link>
        </Button>
        <Badge variant="default">
          {exam.subjectCode} • {exam.subjectName}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-slate-900">{exam.title}</CardTitle>
          <CardDescription>
            Kelas {exam.className} • {exam.questionCount} soal ({exam.totalPoints} poin) • Durasi{" "}
            {exam.durationMinutes} menit
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {exam.description ? (
            <p className="text-sm text-slate-700">{exam.description}</p>
          ) : null}

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Jendela Jadwal</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {exam.startsAt ? formatDateTimeId(exam.startsAt, timeZone) : "-"}
                <br />
                s/d {exam.endsAt ? formatDateTimeId(exam.endsAt, timeZone) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Batas Kesempatan &amp; Toleransi</p>
              <p className="mt-0.5 font-medium text-slate-900">
                Percobaan {exam.attemptsUsed + (exam.canResume ? 0 : 1)} dari {exam.maxAttempts}
                <br />
                Toleransi terlambat: {exam.lateJoinMinutes} menit
              </p>
            </div>
          </div>

          {/* Preflight Check Diagnostics */}
          <div className="space-y-2.5 rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Pemeriksaan Kesiapan Perangkat &amp; Koneksi
            </h2>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-700">
                <Wifi className="h-4 w-4 text-blue-700" aria-hidden="true" />
                <span>Status Koneksi Server</span>
              </span>
              {networkState.online ? (
                <Badge variant="success">
                  Siap {networkState.latencyMs !== null ? `(${networkState.latencyMs} ms)` : ""}
                </Badge>
              ) : (
                <Badge variant="danger">Koneksi Terputus</Badge>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-700">
                <ShieldCheck className="h-4 w-4 text-blue-700" aria-hidden="true" />
                <span>Draf Cadangan Lokal (IndexedDB)</span>
              </span>
              {!storageCheck.checked ? (
                <Badge variant="neutral">Memeriksa...</Badge>
              ) : storageCheck.ok ? (
                <Badge variant="success">Aktif</Badge>
              ) : (
                <Badge variant="warning">Mode Terbatas</Badge>
              )}
            </div>
            {storageCheck.warning ? (
              <Alert variant="warning" className="mt-2">
                {storageCheck.warning}
              </Alert>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Petunjuk &amp; Aturan Ujian</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {exam.instructions ||
                "Kerjakan seluruh soal dengan teliti. Timer dikelola oleh server. Pastikan seluruh jawaban berstatus Tersimpan sebelum menekan Kumpulkan Ujian."}
            </p>
            <ul className="list-disc space-y-1 pl-5 pt-2 text-xs text-slate-600">
              <li>
                Waktu sisa dihitung berdasarkan waktu resmi server UTC: minimal antara sisa durasi
                pengerjaan dan waktu tutup jadwal.
              </li>
              <li>
                Jawaban tersimpan otomatis ke server setiap kali diubah; perubahan saat koneksi
                terputus disimpan sementara secara lokal dan dikirim ulang saat tersambung.
              </li>
              <li>
                Aktivitas perpindahan fokus layar dicatat sebagai log teknis sesi untuk investigasi
                kendala, bukan keputusan pelanggaran otomatis.
              </li>
            </ul>
          </div>

          {securityPolicy ? (
            <StudentExamSecurityCard
              policy={securityPolicy}
              sebStatus={sebStatus}
              onRetrySebVerify={() => void runSebVerification()}
              verifyingSeb={verifyingSeb}
            />
          ) : null}

          {errorMsg ? (
            <Alert variant="danger" title="Tidak Dapat Memulai Sesi">
              {errorMsg}
            </Alert>
          ) : null}

          {!exam.canStart && !exam.canResume ? (
            <Alert variant="warning" title="Ujian Tidak Dapat Dimulai">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{exam.statusMessage}</span>
              </div>
            </Alert>
          ) : (
            <div className="space-y-4 border-t border-slate-200 pt-4">
              {exam.canStart ? (
                <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={acknowledgedRules}
                    onChange={(e) => setAcknowledgedRules(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  <span>
                    Saya telah membaca petunjuk ujian dan memahami bahwa waktu mulai dihitung
                    sejak tombol Mulai Ujian ditekan.
                  </span>
                </label>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                {exam.canResume && exam.activeAttemptId ? (
                  <Button asChild size="lg" className="w-full sm:w-auto">
                    <Link href={`/student/attempts/${exam.activeAttemptId}`}>
                      <PlayCircle className="h-4 w-4" aria-hidden="true" />
                      <span>Lanjutkan Sesi Berlangsung</span>
                    </Link>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    className="w-full sm:w-auto"
                    disabled={!acknowledgedRules || starting || !networkState.online}
                    onClick={handleStartExam}
                  >
                    {starting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{starting ? "Mempersiapkan Soal..." : "Mulai Ujian Sekarang"}</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {exam.canViewReceipt && exam.latestAttemptId ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <span className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>Anda memiliki sesi ujian yang sudah dikumpulkan ({exam.latestReceiptCode ?? "Bukti tersedia"}).</span>
              </span>
              <Link
                href={`/student/attempts/${exam.latestAttemptId}/receipt`}
                className="font-semibold underline"
              >
                Lihat Bukti
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
