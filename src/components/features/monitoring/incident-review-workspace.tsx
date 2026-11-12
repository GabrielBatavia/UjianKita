"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
import type {
  ExamSecurityIncidentRecord,
  IncidentReviewActionRecord,
  IncidentStatus,
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<IncidentStatus, string> = {
  NEW: "Baru",
  UNDER_REVIEW: "Sedang Ditinjau",
  ACKNOWLEDGED: "Diketahui Pengawas",
  RESOLVED: "Selesai",
  DISMISSED: "Diabaikan / Wajar",
};

export function IncidentReviewWorkspace({
  examId,
  initialIncidents,
  timeZone,
  basePath = "/teacher/monitoring",
}: {
  examId: string;
  initialIncidents: ExamSecurityIncidentRecord[];
  timeZone: string;
  basePath?: string;
}) {
  const [incidents, setIncidents] = React.useState(initialIncidents);
  const [activeIncident, setActiveIncident] =
    React.useState<ExamSecurityIncidentRecord | null>(null);
  const [history, setHistory] = React.useState<IncidentReviewActionRecord[]>([]);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  const [nextStatus, setNextStatus] = React.useState<IncidentStatus>("UNDER_REVIEW");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  async function openReviewDialog(inc: ExamSecurityIncidentRecord) {
    setActiveIncident(inc);
    setNextStatus(inc.status === "NEW" ? "UNDER_REVIEW" : inc.status);
    setNote("");
    setErrorMsg(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/teacher/incidents/${inc.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          actions?: IncidentReviewActionRecord[];
        };
        setHistory(data.actions ?? []);
      }
    } catch {
      setHistory([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!activeIncident || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/teacher/incidents/${activeIncident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMsg(data.error ?? "Gagal memperbarui status insiden.");
        return;
      }

      const listRes = await fetch(`/api/teacher/monitoring/${examId}/incidents`, {
        cache: "no-store",
      });
      if (listRes.ok) {
        const refreshed = (await listRes.json()) as {
          incidents?: ExamSecurityIncidentRecord[];
        };
        if (refreshed.incidents) setIncidents(refreshed.incidents);
      }
      setActiveIncident(null);
    } catch {
      setErrorMsg("Terjadi kesalahan jaringan.");
    } finally {
      setSubmitting(false);
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
        <Badge variant="neutral">{incidents.length} Total Insiden</Badge>
      </div>

      <Alert variant="info" title="Kebijakan Tinjauan Insiden Adil">
        <p className="text-xs leading-relaxed">
          Insiden pemantauan adalah catatan pengawasan teknis, bukan keputusan pelanggaran.
          Status insiden tidak pernah mengubah nilai atau menggagalkan pengerjaan ujian siswa.
        </p>
      </Alert>

      {incidents.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-600">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <span>Belum ada insiden yang memerlukan tinjauan pada ujian ini.</span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc) => (
            <Card key={inc.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{inc.title}</CardTitle>
                    <CardDescription>
                      {inc.studentName} {inc.className ? `(${inc.className})` : ""} • Kejadian:{" "}
                      {inc.occurrenceCount}x • Terakhir:{" "}
                      {formatDateTimeId(inc.lastObservedAt, timeZone)}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        inc.severity === "REVIEW_REQUIRED"
                          ? "danger"
                          : inc.severity === "WARNING"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {inc.severity}
                    </Badge>
                    <Badge variant="neutral">{STATUS_LABEL[inc.status]}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0 text-sm">
                <div className="space-y-1">
                  <p className="text-slate-700">{inc.summary}</p>
                  {inc.resolutionSummary ? (
                    <p className="text-xs text-emerald-800">
                      Catatan peninjau: {inc.resolutionSummary}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {inc.attemptId ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`${basePath}/${examId}/students/${inc.attemptId}`}
                      >
                        Lihat Linimasa
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void openReviewDialog(inc)}
                  >
                    <ClipboardList className="h-4 w-4" aria-hidden="true" />
                    <span>Tinjau &amp; Catat</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(activeIncident)}
        onOpenChange={(open) => {
          if (!open) setActiveIncident(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{activeIncident?.title}</DialogTitle>
            <DialogDescription>
              Peserta: {activeIncident?.studentName}. Setiap perubahan status dan catatan
              disimpan permanen pada riwayat tinjauan.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submitReview} className="space-y-4">
            {errorMsg ? <Alert variant="danger">{errorMsg}</Alert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="incident-next-status">Status Tinjauan</Label>
              <Select
                id="incident-next-status"
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as IncidentStatus)}
              >
                <option value="NEW">Baru</option>
                <option value="UNDER_REVIEW">Sedang Ditinjau</option>
                <option value="ACKNOWLEDGED">Diketahui Pengawas</option>
                <option value="RESOLVED">Selesai</option>
                <option value="DISMISSED">Diabaikan / Wajar (False Positive)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incident-review-note">Catatan Tinjauan (Wajib)</Label>
              <Textarea
                id="incident-review-note"
                required
                minLength={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: Siswa mengonfirmasi koneksi Wi-Fi terputus sementara lalu tersambung kembali."
              />
            </div>

            {loadingDetail ? (
              <p className="text-xs text-slate-500">Memuat riwayat tindakan...</p>
            ) : history.length > 0 ? (
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs">
                <p className="font-semibold text-slate-700">Riwayat Sebelumnya</p>
                {history.map((h) => (
                  <div key={h.id} className="border-t border-slate-200 pt-1">
                    <span className="font-semibold">{h.actorName}</span> →{" "}
                    <span>{STATUS_LABEL[h.newStatus]}</span>:{" "}
                    <span className="text-slate-700">{h.note}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveIncident(null)}
              >
                Batal
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Simpan Tinjauan</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
