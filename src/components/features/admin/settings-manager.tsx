"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import type { ResultReleasePolicy, SchoolLevel, SchoolRecord } from "@/domain/academic/types";
import type { AuditEventRecord } from "@/domain/audit/types";
import { formatDateTimeId } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/layout/empty-state";

export function SettingsManager({
  school,
  auditEvents,
}: {
  school: SchoolRecord;
  auditEvents: AuditEventRecord[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState(school.name);
  const [npsn, setNpsn] = React.useState(school.npsn ?? "");
  const [level, setLevel] = React.useState<SchoolLevel>(school.level);
  const [address, setAddress] = React.useState(school.address ?? "");
  const [phone, setPhone] = React.useState(school.phone ?? "");
  const [email, setEmail] = React.useState(school.email ?? "");
  const [timezone, setTimezone] = React.useState(school.timezone);
  const [academicCalendarNote, setAcademicCalendarNote] = React.useState(
    school.academic_calendar_note ?? ""
  );
  const [resultReleasePolicy, setResultReleasePolicy] = React.useState<ResultReleasePolicy>(
    school.result_release_policy
  );
  const [requireExamBrowser, setRequireExamBrowser] = React.useState(
    school.exam_policy.require_exam_browser_in_high_stakes
  );
  const [allowLateJoinMinutes, setAllowLateJoinMinutes] = React.useState(
    String(school.exam_policy.allow_late_join_minutes)
  );
  const [heartbeatIntervalSeconds, setHeartbeatIntervalSeconds] = React.useState(
    String(school.exam_policy.heartbeat_interval_seconds)
  );

  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          npsn: npsn || null,
          level,
          address: address || null,
          phone: phone || null,
          email: email || null,
          timezone,
          academicCalendarNote: academicCalendarNote || null,
          resultReleasePolicy,
          requireExamBrowserInHighStakes: requireExamBrowser,
          allowLateJoinMinutes: Number(allowLateJoinMinutes),
          heartbeatIntervalSeconds: Number(heartbeatIntervalSeconds),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal menyimpan pengaturan sekolah.");
        return;
      }
      setSuccessMessage("Pengaturan sekolah berhasil diperbarui dan dicatat pada log audit.");
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Tabs defaultValue="school">
      <TabsList>
        <TabsTrigger value="school">Profil &amp; Kebijakan Sekolah</TabsTrigger>
        <TabsTrigger value="audit">Log Audit Keamanan ({auditEvents.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="school">
        <form onSubmit={handleSave} className="space-y-6">
          {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}
          {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}

          <Card>
            <CardHeader>
              <CardTitle>Identitas Sekolah</CardTitle>
              <CardDescription>
                Kode sekolah: <span className="font-mono font-semibold">{school.code}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="set-name">Nama Sekolah</Label>
                <Input
                  id="set-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-npsn">NPSN (8 digit, opsional)</Label>
                <Input id="set-npsn" value={npsn} onChange={(e) => setNpsn(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-level">Jenjang</Label>
                <Select
                  id="set-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as SchoolLevel)}
                >
                  <option value="SD">SD</option>
                  <option value="SMP">SMP</option>
                  <option value="SMA">SMA</option>
                  <option value="SMK">SMK</option>
                  <option value="OTHER">Lainnya</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-tz">Zona Waktu Operasional</Label>
                <Select
                  id="set-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  <option value="Asia/Jakarta">WIB (Asia/Jakarta)</option>
                  <option value="Asia/Makassar">WITA (Asia/Makassar)</option>
                  <option value="Asia/Jayapura">WIT (Asia/Jayapura)</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-email">Email Resmi Sekolah</Label>
                <Input
                  id="set-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-phone">Nomor Telepon</Label>
                <Input id="set-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="set-address">Alamat Sekolah</Label>
                <Textarea
                  id="set-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kebijakan Dasar Ujian Sekolah</CardTitle>
              <CardDescription>
                Parameter default ini berlaku untuk pelaksanaan dan rilis nilai ujian di sekolah.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="set-release">Kebijakan Rilis Nilai</Label>
                <Select
                  id="set-release"
                  value={resultReleasePolicy}
                  onChange={(e) => setResultReleasePolicy(e.target.value as ResultReleasePolicy)}
                >
                  <option value="manual_review">
                    Tinjauan Manual (Nilai dirilis setelah disetujui guru/koordinator)
                  </option>
                  <option value="scheduled_release">Rilis Terjadwal</option>
                  <option value="immediate_after_close">
                    Otomatis Setelah Ujian Ditutup (Hanya Pilihan Ganda)
                  </option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-late">Batas Keterlambatan Masuk (Menit)</Label>
                <Input
                  id="set-late"
                  type="number"
                  min={0}
                  max={60}
                  value={allowLateJoinMinutes}
                  onChange={(e) => setAllowLateJoinMinutes(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-hb">Interval Heartbeat Pemantauan (Detik)</Label>
                <Input
                  id="set-hb"
                  type="number"
                  min={10}
                  max={120}
                  value={heartbeatIntervalSeconds}
                  onChange={(e) => setHeartbeatIntervalSeconds(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="set-cal">Catatan Kalender Akademik</Label>
                <Textarea
                  id="set-cal"
                  value={academicCalendarNote}
                  onChange={(e) => setAcademicCalendarNote(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="set-eb"
                  type="checkbox"
                  checked={requireExamBrowser}
                  onChange={(e) => setRequireExamBrowser(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <Label htmlFor="set-eb">
                  Wajibkan ExamBro (Android) / Safe Exam Browser (iOS) untuk ujian resmi
                </Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              <span>Simpan Pengaturan</span>
            </Button>
          </div>
        </form>
      </TabsContent>

      <TabsContent value="audit">
        {auditEvents.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Belum Ada Catatan Audit"
            description="Setiap perubahan data siswa, guru, kelas, pengaturan sekolah, dan sesi masuk akan dicatat di sini secara append-only."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu ({school.timezone})</TableHead>
                <TableHead>Aktor</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Ringkasan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs text-slate-600">
                    {formatDateTimeId(event.created_at, school.timezone)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-semibold text-slate-900">
                      {event.actor_name ?? "Sistem"}
                    </div>
                    <Badge variant="neutral" className="mt-1 text-[10px]">
                      {event.actor_role}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-blue-800">{event.action}</TableCell>
                  <TableCell className="text-sm text-slate-700">{event.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>
    </Tabs>
  );
}
