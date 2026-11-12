"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import type {
  ExamControlCenterSummary,
  ExamSecurityIncidentRecord,
  ExamSecurityPolicyRecord,
  MonitoredStudentRow,
  MonitoringAlertItem,
} from "@/domain/monitoring/phase4-types";
import { SECURITY_REPORT_DISCLAIMER_ID } from "@/domain/monitoring/presence-and-incidents";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTimeId } from "@/lib/utils";
import { ExamSecurityPolicyPanel } from "@/components/features/monitoring/exam-security-policy-panel";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export interface ExamControlCenterPayload {
  exam: {
    examId: string;
    title: string;
    subjectName: string;
    startsAt: string | null;
    endsAt: string | null;
    questionCount: number;
  };
  policy: ExamSecurityPolicyRecord;
  summary: ExamControlCenterSummary;
  alerts: MonitoringAlertItem[];
  students: MonitoredStudentRow[];
  totalFilteredStudents: number;
  page: number;
  pageSize: number;
  incidents: ExamSecurityIncidentRecord[];
  generatedAt: string;
}

const PRESENCE_BADGE: Record<
  MonitoredStudentRow["presenceState"],
  { label: string; variant: "success" | "warning" | "neutral" }
> = {
  RECENTLY_SEEN: { label: "Terpantau Aktif", variant: "success" },
  STALE: { label: "Sinyal Tertunda", variant: "warning" },
  UNKNOWN: { label: "Belum Aktif", variant: "neutral" },
  ENDED: { label: "Sesi Selesai", variant: "neutral" },
};

const SEVERITY_BADGE: Record<
  MonitoredStudentRow["highestSeverity"],
  { label: string; variant: "neutral" | "warning" | "danger" }
> = {
  INFORMATIONAL: { label: "Normal", variant: "neutral" },
  WARNING: { label: "Peringatan", variant: "warning" },
  REVIEW_REQUIRED: { label: "Perlu Tinjauan", variant: "danger" },
};

export function TeacherExamControlCenter({
  initialData,
  timeZone,
  basePath = "/teacher/monitoring",
}: {
  initialData: ExamControlCenterPayload;
  timeZone: string;
  basePath?: string;
}) {
  const [data, setData] = React.useState(initialData);
  const [search, setSearch] = React.useState("");
  const [presenceFilter, setPresenceFilter] = React.useState("ALL");
  const [severityFilter, setSeverityFilter] = React.useState("ALL");
  const [refreshing, setRefreshing] = React.useState(false);
  const [realtimeLive, setRealtimeLive] = React.useState(false);
  const [policyOpen, setPolicyOpen] = React.useState(false);

  const [overrideTarget, setOverrideTarget] = React.useState<MonitoredStudentRow | null>(
    null
  );
  const [overrideReason, setOverrideReason] = React.useState("");
  const [submittingOverride, setSubmittingOverride] = React.useState(false);
  const [overrideFeedback, setOverrideFeedback] = React.useState<string | null>(null);

  const fetchControlCenter = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("search", search.trim());
      if (presenceFilter !== "ALL") qs.set("presence", presenceFilter);
      if (severityFilter !== "ALL") qs.set("severity", severityFilter);
      qs.set("pageSize", "100");
      const res = await fetch(
        `/api/teacher/monitoring/${data.exam.examId}?${qs.toString()}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const next = (await res.json()) as ExamControlCenterPayload;
        setData(next);
      }
    } catch {
      // keep showing last known state
    } finally {
      setRefreshing(false);
    }
  }, [data.exam.examId, presenceFilter, search, severityFilter]);

  // Real-time subscription + 15s resilient fallback polling
  React.useEffect(() => {
    let active = true;
    const pollTimer = window.setInterval(() => {
      if (active) void fetchControlCenter();
    }, 15_000);

    let channel: ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]> | null =
      null;
    try {
      const supabase = createSupabaseBrowserClient();
      channel = supabase
        .channel(`monitoring-exam-${data.exam.examId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "attempt_monitoring_presence",
            filter: `exam_id=eq.${data.exam.examId}`,
          },
          () => {
            if (active) void fetchControlCenter();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "exam_security_incidents",
            filter: `exam_id=eq.${data.exam.examId}`,
          },
          () => {
            if (active) void fetchControlCenter();
          }
        )
        .subscribe((status) => {
          if (active) {
            setRealtimeLive(status === "SUBSCRIBED");
          }
        });
    } catch {
      window.setTimeout(() => {
        if (active) {
          setRealtimeLive(false);
        }
      }, 0);
    }

    return () => {
      active = false;
      window.clearInterval(pollTimer);
      if (channel) {
        try {
          void channel.unsubscribe();
        } catch {
          // ignore cleanup failure
        }
      }
    };
  }, [data.exam.examId, fetchControlCenter]);

  async function handleGrantOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideTarget || submittingOverride) return;
    setSubmittingOverride(true);
    setOverrideFeedback(null);
    try {
      const res = await fetch(
        `/api/teacher/monitoring/${data.exam.examId}/override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: overrideTarget.studentId,
            attemptId: overrideTarget.attemptId ?? undefined,
            reason: overrideReason,
            durationMinutes: 240,
          }),
        }
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setOverrideFeedback(body.error ?? "Gagal memberikan pengecualian.");
        return;
      }
      setOverrideTarget(null);
      setOverrideReason("");
      await fetchControlCenter();
    } catch {
      setOverrideFeedback("Gagal menghubungi server.");
    } finally {
      setSubmittingOverride(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Control Actions & Realtime Status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={realtimeLive ? "success" : "neutral"}>
            {realtimeLive ? (
              <Wifi className="mr-1 h-3 w-3" aria-hidden="true" />
            ) : (
              <WifiOff className="mr-1 h-3 w-3" aria-hidden="true" />
            )}
            <span>
              {realtimeLive ? "Realtime Aktif" : "Sinkronisasi Berkala (15 dtk)"}
            </span>
          </Badge>
          <span className="text-xs text-slate-500">
            Pembaruan terakhir: {formatDateTimeId(data.generatedAt, timeZone)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchControlCenter()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>Muat Ulang</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPolicyOpen((v) => !v)}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            <span>{policyOpen ? "Tutup Kebijakan" : "Atur Kebijakan & SEB"}</span>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/${data.exam.examId}/incidents`}>
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <span>Insiden ({data.summary.openIncidentCount})</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/teacher/monitoring/${data.exam.examId}/report?format=csv`}>
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Ekspor CSV</span>
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            <span>Cetak</span>
          </Button>
        </div>
      </div>

      {/* Policy Config Drawer */}
      {policyOpen ? (
        <ExamSecurityPolicyPanel
          examId={data.exam.examId}
          initialPolicy={data.policy}
          onPolicySaved={() => void fetchControlCenter()}
        />
      ) : null}

      {/* Summary KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Peserta Terdaftar</CardDescription>
            <CardTitle className="font-mono text-2xl">{data.summary.totalAssigned}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Mengerjakan: {data.summary.inProgressCount} • Kumpul: {data.summary.submittedCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Terpantau Aktif</CardDescription>
            <CardTitle className="font-mono text-2xl text-emerald-700">
              {data.summary.recentlySeenCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Heartbeat dalam {data.policy.staleThresholdSeconds} detik terakhir
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Sinyal Tertunda (Stale)</CardDescription>
            <CardTitle className="font-mono text-2xl text-amber-700">
              {data.summary.staleCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Perlu cek jaringan atau perangkat siswa
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Perlu Tinjauan</CardDescription>
            <CardTitle className="font-mono text-2xl text-rose-700">
              {data.summary.reviewRequiredCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Insiden terbuka: {data.summary.openIncidentCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Mode Peramban Aman</CardDescription>
            <CardTitle className="font-mono text-2xl text-blue-700">
              {data.summary.sebVerifiedCount} SEB
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Petunjuk ExamBro Android: {data.summary.exambroHintCount}
          </CardContent>
        </Card>
      </div>

      {/* Honest Disclaimer */}
      <Alert variant="info" title="Prinsip Interpretasi Sinyal Pemantauan">
        <p className="text-xs leading-relaxed">{SECURITY_REPORT_DISCLAIMER_ID}</p>
      </Alert>

      {/* Neutral Alert Feed */}
      {data.alerts.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <span>Antrean Tinjauan Terbaru (Dikelompokkan Otomatis)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.slice(0, 5).map((al) => (
              <div
                key={al.incidentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    {al.studentName} {al.className ? `(${al.className})` : ""} — {al.title}
                  </p>
                  <p className="text-slate-600">
                    {al.summary} ({al.occurrenceCount} kali tercatat)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={al.severity === "REVIEW_REQUIRED" ? "danger" : "warning"}
                  >
                    {al.severity === "REVIEW_REQUIRED" ? "Perlu Tinjauan" : "Peringatan"}
                  </Badge>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={
                        al.attemptId
                          ? `${basePath}/${data.exam.examId}/students/${al.attemptId}`
                          : `${basePath}/${data.exam.examId}/incidents`
                      }
                    >
                      Tinjau
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Filter Bar */}
      <Card>
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search
              className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama siswa, NIS, atau kelas..."
              className="pl-9"
              aria-label="Cari peserta ujian"
            />
          </div>
          <Select
            value={presenceFilter}
            onChange={(e) => setPresenceFilter(e.target.value)}
            aria-label="Filter status koneksi"
          >
            <option value="ALL">Semua Koneksi</option>
            <option value="RECENTLY_SEEN">Terpantau Aktif</option>
            <option value="STALE">Sinyal Tertunda (Stale)</option>
            <option value="UNKNOWN">Belum Aktif</option>
            <option value="ENDED">Sesi Selesai</option>
          </Select>
          <Select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter tingkat keparahan"
          >
            <option value="ALL">Semua Keparahan</option>
            <option value="REVIEW_REQUIRED">Perlu Tinjauan</option>
            <option value="WARNING">Peringatan</option>
            <option value="INFORMATIONAL">Normal</option>
          </Select>
        </CardContent>
      </Card>

      {/* Monitored Students Roster */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <span>Daftar Pemantauan Peserta ({data.totalFilteredStudents})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.students.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Tidak ada peserta sesuai filter saat ini.
            </p>
          ) : (
            <>
              {/* Mobile Student Roster Cards (< md) */}
              <div className="space-y-3 md:hidden">
                {data.students.map((row) => {
                  const pBadge = PRESENCE_BADGE[row.presenceState];
                  const sBadge = SEVERITY_BADGE[row.highestSeverity];
                  return (
                    <div
                      key={row.studentId}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{row.studentName}</p>
                          <p className="text-xs text-slate-500">
                            {row.studentNis ?? "Tanpa NIS"} • {row.className ?? "-"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant={pBadge.variant} className="text-[10px]">
                            {pBadge.label}
                          </Badge>
                          <Badge variant={sBadge.variant} className="text-[10px]">
                            {sBadge.label}
                          </Badge>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>
                            Progres: {row.answeredCount}/{row.totalQuestions} soal
                          </span>
                          <span className="font-mono font-semibold">{row.progressPercent}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, row.progressPercent))}%` }}
                          />
                        </div>
                      </div>

                      {/* Browser & Activity metadata */}
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                        <div>
                          <span className="text-[10px] text-slate-400 block uppercase">Peramban</span>
                          <span className="truncate block font-medium text-slate-800">
                            {row.browserPlatform}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 block uppercase">Sinyal Anomali</span>
                          <span>
                            Tab: {row.visibilityHiddenCount}x • Salin: {row.copyPasteCount}x
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
                        {row.attemptId ? (
                          <Button asChild size="sm" variant="outline" className="min-h-[40px] px-3 font-semibold text-xs">
                            <Link href={`${basePath}/${data.exam.examId}/students/${row.attemptId}`}>
                              <span>Linimasa</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-[40px] px-3 text-xs"
                          onClick={() => {
                            setOverrideTarget(row);
                            setOverrideFeedback(null);
                          }}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Pengecualian</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Student Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Siswa</TableHead>
                      <TableHead>Sesi</TableHead>
                      <TableHead>Koneksi</TableHead>
                      <TableHead>Progres</TableHead>
                      <TableHead>Peramban &amp; Kepercayaan</TableHead>
                      <TableHead>Sinyal Aktivitas</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.students.map((row) => {
                      const pBadge = PRESENCE_BADGE[row.presenceState];
                      const sBadge = SEVERITY_BADGE[row.highestSeverity];
                      return (
                        <TableRow key={row.studentId}>
                          <TableCell>
                            <p className="font-semibold text-slate-900">{row.studentName}</p>
                            <p className="text-xs text-slate-500">
                              {row.studentNis ?? "Tanpa NIS"} • {row.className ?? "-"}
                            </p>
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {row.attemptStatus}
                          </TableCell>
                          <TableCell>
                            <Badge variant={pBadge.variant}>{pBadge.label}</Badge>
                            {row.secondsSinceLastHeartbeat !== null ? (
                              <p className="mt-1 text-[11px] text-slate-500">
                                {row.secondsSinceLastHeartbeat} dtk lalu
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.answeredCount}/{row.totalQuestions} ({row.progressPercent}%)
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="block font-medium text-slate-800">
                              {row.browserPlatform}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {row.browserTrustLevel === "verified_seb_header_and_key" ||
                              row.browserTrustLevel === "verified_seb_js_key"
                                ? "SEB Terverifikasi"
                                : row.browserTrustLevel === "staff_override"
                                  ? "Pengecualian Pengawas"
                                  : row.browserTrustLevel === "unverified_client_hint"
                                    ? "Petunjuk ExamBro (Unverified)"
                                    : "Peramban Standar"}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-700">
                            <div>Fokus pindah: {row.visibilityHiddenCount}x</div>
                            <div>Muat ulang: {row.reloadCount}x</div>
                            <div>Salin/Tempel: {row.copyPasteCount}x</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={sBadge.variant}>{sBadge.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {row.attemptId ? (
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    href={`${basePath}/${data.exam.examId}/students/${row.attemptId}`}
                                  >
                                    <span>Linimasa</span>
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                  </Link>
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setOverrideTarget(row);
                                  setOverrideFeedback(null);
                                }}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Pengecualian</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Emergency Browser Policy Override Dialog */}
      <Dialog
        open={Boolean(overrideTarget)}
        onOpenChange={(open) => {
          if (!open) setOverrideTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pengecualian Kebijakan Peramban Darurat</DialogTitle>
            <DialogDescription>
              Berikan izin sementara bagi{" "}
              <strong>{overrideTarget?.studentName}</strong> agar dapat memulai atau
              melanjutkan ujian apabila mengalami kendala perangkat pada aplikasi Safe Exam
              Browser. Seluruh pengecualian dicatat pada log audit sekolah.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGrantOverride} className="space-y-4">
            {overrideFeedback ? (
              <Alert variant="danger">{overrideFeedback}</Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">Alasan Pengecualian (Wajib)</Label>
              <Textarea
                id="override-reason"
                required
                minLength={5}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Contoh: Aplikasi SEB iPad siswa gagal memuat profil, dipindahkan ke Chromebook ruang pengawas 2."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOverrideTarget(null)}
              >
                Batal
              </Button>
              <Button type="submit" disabled={submittingOverride}>
                {submittingOverride ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                <span>Aktifkan Pengecualian (4 Jam)</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
