"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import type {
  ExamClassAssignmentItem,
  ExamPublicationEventItem,
  ExamRecord,
  ExamVersionSummary,
} from "@/domain/exams/phase2-types";
import { formatDateTimeId } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EXAM_STATUS_META } from "@/components/features/teacher/exams-list";

export function AdminExamDetail({
  exam,
  assignments,
  publishedVersions,
  publicationEvents,
  timeZone,
}: {
  exam: ExamRecord;
  assignments: ExamClassAssignmentItem[];
  publishedVersions: ExamVersionSummary[];
  publicationEvents: ExamPublicationEventItem[];
  timeZone: string;
}) {
  const router = useRouter();
  const statusMeta = EXAM_STATUS_META[exam.status];
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function handleAdminAction(targetStatus: "CLOSED" | "ARCHIVED") {
    if (!reason.trim()) {
      setErrorMessage("Alasan administratif wajib diisi sebelum menutup atau mengarsipkan ujian.");
      return;
    }
    setErrorMessage(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/exams/${exam.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionLock: exam.version_lock,
          targetStatus,
          notes: reason.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal memproses tindakan administratif.");
        return;
      }
      setReason("");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/exams">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Kembali</span>
            </Link>
          </Button>
          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/exams/${exam.id}/preview`}>Pratinjau Soal</Link>
        </Button>
      </div>

      {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi &amp; Kepemilikan</CardTitle>
            <CardDescription>Pengawasan lintas kelas untuk administrator sekolah</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">Pembuat</span>
              <span className="font-semibold">{exam.created_by_name ?? "Guru"}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">Mata Pelajaran</span>
              <span className="font-semibold">
                {exam.subject_code} — {exam.subject_name}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">Durasi &amp; KKM</span>
              <span className="font-mono">
                {exam.duration_minutes} menit • KKM {exam.passing_score}
              </span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-600">Jumlah Soal &amp; Poin</span>
              <span className="font-mono">
                {exam.question_count ?? 0} soal • {exam.total_points ?? 0} poin
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Kelas Peserta ({assignments.length})</span>
              <span className="text-right font-medium">
                {assignments.map((a) => a.class_name).join(", ") || "Belum ditetapkan"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <CardTitle>Tindakan Administratif Resmi</CardTitle>
            </div>
            <CardDescription>
              Administrator dapat menutup atau mengarsipkan ujian dengan catatan alasan audit, tanpa
              dapat mengubah konten soal yang telah diterbitkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {exam.status === "ARCHIVED" ? (
              <p className="text-sm text-slate-600">
                Ujian ini sudah diarsipkan sebagai catatan historis sekolah.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="adm-reason">Alasan Audit (Wajib)</Label>
                  <Textarea
                    id="adm-reason"
                    rows={3}
                    placeholder="Contoh: Penutupan sesi oleh administrator karena perubahan jadwal sekolah."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {exam.status === "PUBLISHED" ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => handleAdminAction("CLOSED")}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      <span>Tutup Ujian Sekarang</span>
                    </Button>
                  ) : null}
                  {exam.status === "DRAFT" ||
                  exam.status === "READY_FOR_REVIEW" ||
                  exam.status === "PUBLISHED" ||
                  exam.status === "CLOSED" ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleAdminAction("ARCHIVED")}
                    >
                      Arsipkan Ujian
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Versi Terpublikasi ({publishedVersions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {publishedVersions.length === 0 ? (
            <p className="text-sm text-slate-600">Belum ada versi yang diterbitkan.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versi</TableHead>
                  <TableHead>Diterbitkan Oleh</TableHead>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Hash Integritas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {publishedVersions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono font-semibold">v{v.version_number}</TableCell>
                    <TableCell>{v.published_by_name ?? "Guru"}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {formatDateTimeId(v.published_at, timeZone)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">
                      {v.snapshot_hash.slice(0, 20)}...
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jejak Kejadian Publikasi &amp; Pengawasan</CardTitle>
        </CardHeader>
        <CardContent>
          {publicationEvents.length === 0 ? (
            <p className="text-sm text-slate-600">Belum ada catatan kejadian.</p>
          ) : (
            <div className="divide-y divide-slate-200 text-sm">
              {publicationEvents.map((ev) => (
                <div key={ev.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between">
                  <div>
                    <Badge variant="neutral" className="mr-2 font-mono text-[11px]">
                      {ev.event_type}
                    </Badge>
                    <span className="font-semibold">{ev.actor_name ?? "Pengguna"}</span>
                    {ev.notes ? <p className="mt-1 text-xs text-slate-600">{ev.notes}</p> : null}
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDateTimeId(ev.created_at, timeZone)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
