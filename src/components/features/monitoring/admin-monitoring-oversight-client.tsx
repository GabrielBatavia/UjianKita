"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import type { AdminMonitoringOverviewData } from "@/domain/monitoring/phase4-types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AdminMonitoringOversightClient({
  initialData,
  timeZone,
}: {
  initialData: AdminMonitoringOverviewData;
  timeZone: string;
}) {
  const [data, setData] = React.useState(initialData);
  const [refreshing, setRefreshing] = React.useState(false);
  const [daysToKeep, setDaysToKeep] = React.useState(90);
  const [purging, setPurging] = React.useState(false);
  const [retentionMsg, setRetentionMsg] = React.useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/monitoring", { cache: "no-store" });
      if (res.ok) {
        setData((await res.json()) as AdminMonitoringOverviewData);
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function runRetention(dryRun: boolean) {
    setPurging(true);
    setRetentionMsg(null);
    try {
      const res = await fetch("/api/admin/monitoring/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysToKeep, dryRun }),
      });
      const out = (await res.json()) as {
        candidateEvents?: number;
        candidateIncidents?: number;
        error?: string;
      };
      if (!res.ok) {
        setRetentionMsg(out.error ?? "Gagal menjalankan retensi.");
        return;
      }
      setRetentionMsg(
        dryRun
          ? `Simulasi retensi (> ${daysToKeep} hari): ditemukan ${out.candidateEvents ?? 0} log aktivitas dan ${out.candidateIncidents ?? 0} insiden tertutup.`
          : `Pembersihan selesai: ${out.candidateEvents ?? 0} log aktivitas lama dan ${out.candidateIncidents ?? 0} insiden tertutup telah dihapus.`
      );
      if (!dryRun) await handleRefresh();
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          Pembaruan terakhir: {formatDateTimeId(data.generatedAt, timeZone)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          <span>Muat Ulang Ringkasan</span>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Ujian Aktif Berjalan</CardDescription>
            <CardTitle className="font-mono text-2xl">{data.activeExamCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Total peserta aktif: {data.totalActiveStudents}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Koneksi Tertunda</CardDescription>
            <CardTitle className="font-mono text-2xl text-amber-700">
              {data.totalStaleConnections}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Melampaui batas heartbeat sekolah
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Insiden Terbuka</CardDescription>
            <CardTitle className="font-mono text-2xl text-rose-700">
              {data.totalOpenIncidents}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Memerlukan tinjauan guru/pengawas
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription>Peserta Perlu Tinjauan</CardDescription>
            <CardTitle className="font-mono text-2xl text-rose-700">
              {data.totalReviewRequiredStudents}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            Lintas seluruh ruang ujian aktif
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daftar Pengawasan Ujian Sekolah</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ujian</TableHead>
                  <TableHead>Kebijakan Peramban</TableHead>
                  <TableHead>Aktif / Terdaftar</TableHead>
                  <TableHead>Koneksi Tertunda</TableHead>
                  <TableHead>Insiden Terbuka</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.exams.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                      Belum ada ujian berstatus Terbit atau Ditutup untuk dipantau.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.exams.map((ex) => (
                    <TableRow key={ex.examId}>
                      <TableCell>
                        <p className="font-semibold text-slate-900">{ex.title}</p>
                        <p className="text-xs text-slate-500">{ex.subjectName}</p>
                      </TableCell>
                      <TableCell className="text-xs">{ex.browserPolicy}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {ex.activeStudents} aktif • {ex.submittedCount}/{ex.totalAssigned} kumpul
                      </TableCell>
                      <TableCell>
                        <Badge variant={ex.staleConnections > 0 ? "warning" : "neutral"}>
                          {ex.staleConnections}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ex.openIncidents > 0 ? "danger" : "neutral"}>
                          {ex.openIncidents}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/monitoring/${ex.examId}`}>
                            <span>Buka Kontrol</span>
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <span>Audit Keamanan &amp; Pengecualian Terbaru</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentAuditEvents.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada catatan audit monitoring.</p>
            ) : (
              data.recentAuditEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div className="flex justify-between gap-2 font-semibold text-slate-900">
                    <span>{ev.action}</span>
                    <span className="font-mono text-slate-500">
                      {formatDateTimeId(ev.createdAt, timeZone)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-700">{ev.summary}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4 text-slate-700" aria-hidden="true" />
              <span>Kebijakan Retensi Data Pemantauan</span>
            </CardTitle>
            <CardDescription>
              Hapus log telemetri sesi selesai dan insiden tertutup yang melampaui masa simpan
              sekolah (minimal 30 hari). Hasil nilai dan bukti pengumpulan tidak pernah dihapus.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {retentionMsg ? <Alert variant="info">{retentionMsg}</Alert> : null}
            <div className="space-y-1.5">
              <Label htmlFor="retention-days">Simpan Log Pemantauan (Hari Terakhir)</Label>
              <Input
                id="retention-days"
                type="number"
                min={30}
                max={1825}
                value={daysToKeep}
                onChange={(e) => setDaysToKeep(Math.max(30, Number(e.target.value) || 90))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={purging}
                onClick={() => void runRetention(true)}
              >
                Simulasi (Dry Run)
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={purging}
                onClick={() => void runRetention(false)}
              >
                {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Jalankan Pembersihan Retensi</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
