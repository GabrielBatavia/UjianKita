"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import type { AcademicYearRecord } from "@/domain/academic/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ExamCreateForm({
  authorizedSubjects,
  authorizedClasses,
  academicYears,
}: {
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
  authorizedClasses: Array<{ id: string; name: string; grade_level: string; academic_year_id: string }>;
  academicYears: AcademicYearRecord[];
}) {
  const router = useRouter();
  const activeYear = academicYears.find((y) => y.is_active) ?? academicYears[0];

  const [title, setTitle] = React.useState("");
  const [subjectId, setSubjectId] = React.useState(authorizedSubjects[0]?.id ?? "");
  const [academicYearId, setAcademicYearId] = React.useState(activeYear?.id ?? "");
  const [description, setDescription] = React.useState("");
  const [instructions, setInstructions] = React.useState(
    "Bacalah setiap soal dengan saksama. Periksa kembali jawaban Anda sebelum menekan tombol Kumpulkan."
  );
  const [durationMinutes, setDurationMinutes] = React.useState("60");
  const [maxAttempts, setMaxAttempts] = React.useState("1");
  const [passingScore, setPassingScore] = React.useState("70");
  const [randomizeQuestions, setRandomizeQuestions] = React.useState(true);
  const [randomizeOptions, setRandomizeOptions] = React.useState(true);
  const [resultReleasePolicy, setResultReleasePolicy] = React.useState<
    "manual" | "after_submit_if_no_essay" | "after_window_close"
  >("manual");
  const [selectedClassIds, setSelectedClassIds] = React.useState<string[]>([]);
  const [startsAtLocal, setStartsAtLocal] = React.useState("");
  const [endsAtLocal, setEndsAtLocal] = React.useState("");

  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  function toggleClass(cid: string) {
    setSelectedClassIds((prev) =>
      prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);

    const startsAt = startsAtLocal ? new Date(startsAtLocal).toISOString() : null;
    const endsAt = endsAtLocal ? new Date(endsAtLocal).toISOString() : null;

    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setErrorMessage("Waktu selesai ujian harus lebih lambat daripada waktu mulai.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/teacher/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          subjectId,
          academicYearId,
          description: description || null,
          instructions: instructions || null,
          durationMinutes: Number(durationMinutes),
          maxAttempts: Number(maxAttempts),
          passingScore: Number(passingScore),
          randomizeQuestions,
          randomizeOptions,
          resultReleasePolicy,
          startsAt,
          endsAt,
          classIds: selectedClassIds,
        }),
      });
      const data = (await res.json()) as { error?: string; examId?: string };
      if (!res.ok || !data.examId) {
        setErrorMessage(data.error ?? "Gagal membuat draf ujian.");
        return;
      }

      router.push(`/teacher/exams/${data.examId}`);
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/teacher/exams">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Manajemen Ujian</span>
          </Link>
        </Button>
      </div>

      {authorizedSubjects.length === 0 ? (
        <Alert variant="warning" title="Belum Ada Mata Pelajaran Diampu">
          Anda belum ditetapkan pada mata pelajaran atau kelas oleh administrator sekolah.
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

        <Card>
          <CardHeader>
            <CardTitle>Informasi &amp; Pengaturan Ujian</CardTitle>
            <CardDescription>
              Setelah draf dibuat, Anda dapat memilih soal dari bank soal, meninjau pratinjau
              siswa, lalu menerbitkan versi ujian yang terkunci.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ex-title">Nama / Judul Ujian</Label>
              <Input
                id="ex-title"
                placeholder="Mis. Penilaian Tengah Semester Matematika Kelas X"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ex-subject">Mata Pelajaran</Label>
              <Select
                id="ex-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                required
              >
                {authorizedSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ex-year">Tahun Ajaran</Label>
              <Select
                id="ex-year"
                value={academicYearId}
                onChange={(e) => setAcademicYearId(e.target.value)}
                required
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name} ({y.semester})
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ex-dur">Durasi Pengerjaan (Menit)</Label>
              <Input
                id="ex-dur"
                type="number"
                min={1}
                max={480}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ex-att">Maks. Percobaan</Label>
                <Input
                  id="ex-att"
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ex-pass">KKM / Nilai Tuntas</Label>
                <Input
                  id="ex-pass"
                  type="number"
                  min={0}
                  step="0.5"
                  value={passingScore}
                  onChange={(e) => setPassingScore(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ex-start">Waktu Mulai (Opsional saat draf)</Label>
              <Input
                id="ex-start"
                type="datetime-local"
                value={startsAtLocal}
                onChange={(e) => setStartsAtLocal(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ex-end">Waktu Selesai (Opsional saat draf)</Label>
              <Input
                id="ex-end"
                type="datetime-local"
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ex-desc">Deskripsi Singkat</Label>
              <Textarea
                id="ex-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ex-inst">Petunjuk Pengerjaan Siswa</Label>
              <Textarea
                id="ex-inst"
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={randomizeQuestions}
                  onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>Acak urutan soal per percobaan siswa (deterministik, tidak berubah saat refresh)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={randomizeOptions}
                  onChange={(e) => setRandomizeOptions(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700"
                />
                <span>Acak urutan pilihan jawaban (kecuali soal yang dikunci)</span>
              </label>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ex-release-policy">Kebijakan Rilis Nilai Siswa</Label>
              <Select
                id="ex-release-policy"
                value={resultReleasePolicy}
                onChange={(e) =>
                  setResultReleasePolicy(
                    e.target.value as "manual" | "after_submit_if_no_essay" | "after_window_close"
                  )
                }
              >
                <option value="manual">Manual — Guru merilis hasil secara eksplisit</option>
                <option value="after_submit_if_no_essay">
                  Otomatis setelah kumpul (jika tanpa esai)
                </option>
                <option value="after_window_close">
                  Otomatis setelah jendela ujian kelas berakhir
                </option>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pilih Kelas Peserta</CardTitle>
            <CardDescription>
              Hanya kelas yang Anda ampu atau walikan yang ditampilkan di sini.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authorizedClasses.length === 0 ? (
              <p className="text-sm text-slate-600">
                Belum ada kelas diampu. Anda dapat menambahkan kelas nanti pada tab Jadwal &amp;
                Kelas.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {authorizedClasses.map((cls) => (
                  <label
                    key={cls.id}
                    className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedClassIds.includes(cls.id)}
                      onChange={() => toggleClass(cls.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700"
                    />
                    <span className="font-medium text-slate-900">{cls.name}</span>
                    <span className="text-xs text-slate-500">Tingkat {cls.grade_level}</span>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button asChild type="button" variant="outline">
            <Link href="/teacher/exams">Batal</Link>
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={saving || authorizedSubjects.length === 0 || !academicYearId}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            <span>Buat Draf &amp; Pilih Soal</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
