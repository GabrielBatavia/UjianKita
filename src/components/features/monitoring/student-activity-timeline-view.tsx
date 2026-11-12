"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Loader2, ShieldCheck } from "lucide-react";
import type {
  ExamSecurityIncidentRecord,
  HiddenVisibleDurationSpan,
  MonitoredStudentRow,
  MonitoringActivityTimelineEntry,
} from "@/domain/monitoring/phase4-types";
import { formatDateTimeId } from "@/lib/utils";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SOURCE_BADGE: Record<
  MonitoringActivityTimelineEntry["source"],
  { label: string; variant: "default" | "warning" | "neutral" }
> = {
  SERVER_CONFIRMED: { label: "Terkonfirmasi Server", variant: "default" },
  SERVER_INFERRED: { label: "Inferensi Server", variant: "warning" },
  CLIENT_REPORTED: { label: "Laporan Klien", variant: "neutral" },
};

export function StudentActivityTimelineView({
  examId,
  student,
  timeline,
  hiddenDurations,
  incidents,
  disclaimer,
  timeZone,
  basePath = "/teacher/monitoring",
}: {
  examId: string;
  student: MonitoredStudentRow;
  timeline: MonitoringActivityTimelineEntry[];
  hiddenDurations: HiddenVisibleDurationSpan[];
  incidents: ExamSecurityIncidentRecord[];
  disclaimer: string;
  timeZone: string;
  basePath?: string;
}) {
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [hasOverride, setHasOverride] = React.useState(student.hasManualOverride);

  async function submitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!student.attemptId || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/teacher/attempts/${student.attemptId}/browser-override`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason, durationMinutes: 240 }),
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback(data.error ?? "Gagal mencatat pengecualian.");
        return;
      }
      setHasOverride(true);
      setOverrideOpen(false);
      setReason("");
    } catch {
      setFeedback("Gagal menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href={`${basePath}/${examId}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Pusat Kontrol</span>
          </Link>
        </Button>

        {student.attemptId ? (
          <Button type="button" size="sm" onClick={() => setOverrideOpen(true)}>
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>
              {hasOverride
                ? "Perbarui Pengecualian Peramban"
                : "Berikan Pengecualian Peramban"}
            </span>
          </Button>
        ) : null}
      </div>

      <Alert variant="info" title="Transparansi Sumber Bukti">
        <p className="text-xs leading-relaxed">{disclaimer}</p>
      </Alert>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Peserta</CardDescription>
            <CardTitle className="text-base">{student.studentName}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            NIS: {student.studentNis ?? "-"} • Kelas: {student.className ?? "-"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Status Koneksi &amp; Sesi</CardDescription>
            <CardTitle className="text-base">{student.presenceState}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Status: {student.attemptStatus}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Kepercayaan Peramban</CardDescription>
            <CardTitle className="text-sm">{student.browserTrustLevel}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Platform: {student.browserPlatform}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Rekap Sinyal Klien</CardDescription>
            <CardTitle className="font-mono text-base">
              Fokus {student.visibilityHiddenCount}x • Muat ulang {student.reloadCount}x
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Putus sinyal: {student.connectionGapCount}x • Salin: {student.copyPasteCount}x
          </CardContent>
        </Card>
      </div>

      {/* Paired Hidden/Visible Duration Windows */}
      {hiddenDurations.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <span>Rentang Waktu Halaman Tidak Aktif (Perpindahan Fokus)</span>
            </CardTitle>
            <CardDescription>
              Pasangan sinyal keluar-fokus dan kembali-aktif berdasarkan laporan peramban siswa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hiddenDurations.map((span, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <span>
                  Mulai tidak aktif: <strong>{formatDateTimeId(span.hiddenAt, timeZone)}</strong>
                  {span.visibleAt
                    ? ` → Kembali aktif: ${formatDateTimeId(span.visibleAt, timeZone)}`
                    : " → Masih di latar belakang saat laporan dibuat"}
                </span>
                <Badge variant={span.durationSeconds && span.durationSeconds >= 60 ? "danger" : "warning"}>
                  {span.durationSeconds !== null ? `~${span.durationSeconds} detik` : "Belum kembali"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Open / Historical Incidents */}
      {incidents.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Insiden Terkait Sesi Ini</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {incidents.map((inc) => (
              <div
                key={inc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {inc.title} ({inc.status})
                  </p>
                  <p className="text-slate-600">{inc.summary}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`${basePath}/${examId}/incidents`}>Buka Tinjauan</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Chronological Activity Log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Linimasa Aktivitas Kronologis ({timeline.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada peristiwa aktivitas tercatat.</p>
          ) : (
            timeline.map((item) => {
              const sMeta = SOURCE_BADGE[item.source];
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    {item.detail ? <p className="text-slate-600">{item.detail}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={sMeta.variant}>{sMeta.label}</Badge>
                    <span className="font-mono text-slate-500">
                      {formatDateTimeId(item.occurredAt, timeZone)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Berikan Pengecualian Peramban Darurat</DialogTitle>
            <DialogDescription>
              Izinkan {student.studentName} melanjutkan sesi tanpa kunci Safe Exam Browser apabila
              perangkat mengalami gangguan teknis.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitOverride} className="space-y-4">
            {feedback ? <Alert variant="danger">{feedback}</Alert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="timeline-override-reason">Alasan Resmi Pengawas</Label>
              <Textarea
                id="timeline-override-reason"
                required
                minLength={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: Aplikasi SEB tertutup berulang saat pemadaman listrik lab."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOverrideOpen(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Pengecualian</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
