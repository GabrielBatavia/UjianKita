"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, History, ImageOff, Loader2, Plus, Save, Trash2 } from "lucide-react";
import type {
  QuestionDifficulty,
  QuestionOptionItem,
  QuestionRecord,
  QuestionStatus,
  QuestionType,
  QuestionVersionRecord,
  ScoringPolicy,
} from "@/domain/exams/phase2-types";
import { validateQuestionDomainRules } from "@/domain/exams/question-rules";
import { formatDateTimeId } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QuestionContentRenderer } from "@/components/features/exams/question-content-renderer";

const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const DEFAULT_FOUR_OPTIONS: QuestionOptionItem[] = [
  { optionKey: "A", optionText: "", displayOrder: 0 },
  { optionKey: "B", optionText: "", displayOrder: 1 },
  { optionKey: "C", optionText: "", displayOrder: 2 },
  { optionKey: "D", optionText: "", displayOrder: 3 },
];

const TRUE_FALSE_OPTIONS: QuestionOptionItem[] = [
  { optionKey: "TRUE", optionText: "Benar", displayOrder: 0 },
  { optionKey: "FALSE", optionText: "Salah", displayOrder: 1 },
];

export function QuestionEditor({
  mode,
  authorizedSubjects,
  initialQuestion,
  versionHistory = [],
}: {
  mode: "create" | "edit";
  authorizedSubjects: Array<{ id: string; code: string; name: string }>;
  initialQuestion?: QuestionRecord;
  versionHistory?: QuestionVersionRecord[];
}) {
  const router = useRouter();
  const ver = initialQuestion?.current_version;

  const [subjectId, setSubjectId] = React.useState(
    initialQuestion?.subject_id ?? authorizedSubjects[0]?.id ?? ""
  );
  const [questionType, setQuestionType] = React.useState<QuestionType>(
    initialQuestion?.question_type ?? "single_choice"
  );
  const [difficulty, setDifficulty] = React.useState<QuestionDifficulty>(
    initialQuestion?.difficulty ?? "medium"
  );
  const [status, setStatus] = React.useState<QuestionStatus>(
    initialQuestion?.status ?? "active"
  );
  const [topic, setTopic] = React.useState(initialQuestion?.topic ?? "");
  const [tagsRaw, setTagsRaw] = React.useState((initialQuestion?.tags ?? []).join(", "));
  const [stem, setStem] = React.useState(ver?.stem ?? "");
  const [explanation, setExplanation] = React.useState(ver?.explanation ?? "");
  const [points, setPoints] = React.useState(String(ver?.points ?? 2));
  const [scoringPolicy, setScoringPolicy] = React.useState<ScoringPolicy>(
    ver?.scoring_policy ?? "exact_match"
  );
  const [rubricNotes, setRubricNotes] = React.useState(ver?.rubric_notes ?? "");
  const [preserveOptionOrder, setPreserveOptionOrder] = React.useState(
    ver?.preserve_option_order ?? false
  );
  const [options, setOptions] = React.useState<QuestionOptionItem[]>(
    ver?.options && ver.options.length > 0 ? ver.options : DEFAULT_FOUR_OPTIONS
  );
  const [correctKeys, setCorrectKeys] = React.useState<string[]>(
    ver?.correct_option_keys ?? ["A"]
  );

  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  function handleTypeChange(nextType: QuestionType) {
    setQuestionType(nextType);
    if (nextType === "essay") {
      setOptions([]);
      setCorrectKeys([]);
      setScoringPolicy("manual_rubric");
    } else if (nextType === "true_false") {
      setOptions(TRUE_FALSE_OPTIONS);
      setCorrectKeys(["TRUE"]);
      setScoringPolicy("exact_match");
    } else {
      if (options.length < 2 || options.some((o) => o.optionKey === "TRUE")) {
        setOptions(DEFAULT_FOUR_OPTIONS);
      }
      if (nextType === "single_choice") {
        setCorrectKeys([options[0]?.optionKey ?? "A"]);
        setScoringPolicy("exact_match");
      } else {
        setCorrectKeys(correctKeys.length > 0 ? correctKeys : ["A"]);
        setScoringPolicy("exact_match");
      }
    }
  }

  function handleAddOption() {
    if (options.length >= 8) return;
    const nextKey = OPTION_KEYS[options.length] ?? `O${options.length + 1}`;
    setOptions([...options, { optionKey: nextKey, optionText: "", displayOrder: options.length }]);
  }

  function handleRemoveOption(index: number) {
    if (options.length <= 2) return;
    const removedKey = options[index]?.optionKey;
    const next = options
      .filter((_, i) => i !== index)
      .map((o, i) => ({
        ...o,
        optionKey: OPTION_KEYS[i] ?? o.optionKey,
        displayOrder: i,
      }));
    setOptions(next);
    if (removedKey) {
      setCorrectKeys((prev) => prev.filter((k) => k !== removedKey && next.some((o) => o.optionKey === k)));
    }
  }

  function toggleCorrectKey(key: string) {
    if (questionType === "single_choice" || questionType === "true_false") {
      setCorrectKeys([key]);
    } else {
      setCorrectKeys((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsedPoints = Number(points);
    const domainCheck = validateQuestionDomainRules({
      questionType,
      stem,
      points: parsedPoints,
      scoringPolicy,
      options: questionType === "essay" ? [] : options,
      correctOptionKeys: questionType === "essay" ? [] : correctKeys,
    });

    if (!domainCheck.valid) {
      setErrorMessage(domainCheck.errors.join(" "));
      return;
    }

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);

    const payload = {
      subjectId,
      questionType,
      difficulty,
      topic: topic || null,
      tags,
      status,
      stem,
      explanation: explanation || null,
      points: parsedPoints,
      scoringPolicy: domainCheck.normalizedScoringPolicy,
      rubricNotes: rubricNotes || null,
      preserveOptionOrder,
      options: domainCheck.normalizedOptions,
      correctOptionKeys: domainCheck.normalizedCorrectKeys,
    };

    setSaving(true);
    try {
      const endpoint =
        mode === "create"
          ? "/api/teacher/questions"
          : `/api/teacher/questions/${initialQuestion?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        questionId?: string;
        versionNumber?: number;
      };

      if (!res.ok) {
        setErrorMessage(data.error ?? "Gagal menyimpan soal.");
        return;
      }

      if (mode === "create" && data.questionId) {
        router.push("/teacher/questions");
        router.refresh();
        return;
      }

      setSuccessMessage(`Soal berhasil disimpan sebagai versi baru (v${data.versionNumber ?? "?"}).`);
      router.refresh();
    } catch {
      setErrorMessage("Gagal menghubungi server. Periksa koneksi Anda.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link href="/teacher/questions">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Kembali ke Bank Soal</span>
          </Link>
        </Button>
        {mode === "edit" && ver ? (
          <Badge variant="default">Versi Aktif: v{ver.version_number}</Badge>
        ) : null}
      </div>

      {authorizedSubjects.length === 0 ? (
        <Alert variant="warning" title="Belum Ada Mata Pelajaran Diampu">
          Anda perlu ditetapkan minimal pada satu mata pelajaran oleh administrator sebelum membuat
          soal.
        </Alert>
      ) : null}

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor Soal</TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Pratinjau Siswa
          </TabsTrigger>
          {mode === "edit" ? (
            <TabsTrigger value="history">
              <History className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Riwayat Versi ({versionHistory.length})
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="editor">
          <form onSubmit={handleSubmit} className="space-y-6">
            {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}
            {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}

            <Card>
              <CardHeader>
                <CardTitle>Metadata &amp; Penilaian Soal</CardTitle>
                <CardDescription>
                  Setiap perubahan soal saat edit akan membuat versi revisi baru tanpa mengubah
                  ujian yang sudah diterbitkan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="q-subject">Mata Pelajaran</Label>
                  <Select
                    id="q-subject"
                    value={subjectId}
                    disabled={mode === "edit"}
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
                  <Label htmlFor="q-type">Tipe Soal</Label>
                  <Select
                    id="q-type"
                    value={questionType}
                    disabled={mode === "edit"}
                    onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
                  >
                    <option value="single_choice">Pilihan Ganda (1 Jawaban)</option>
                    <option value="multiple_choice">Pilihan Jamak (Banyak Jawaban)</option>
                    <option value="true_false">Benar / Salah</option>
                    <option value="essay">Esai (Penilaian Manual)</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="q-diff">Tingkat Kesulitan</Label>
                  <Select
                    id="q-diff"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty)}
                  >
                    <option value="easy">Mudah</option>
                    <option value="medium">Sedang</option>
                    <option value="hard">Sulit</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="q-points">Bobot Poin</Label>
                  <Input
                    id="q-points"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="1000"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="q-status">Status Soal</Label>
                  <Select
                    id="q-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as QuestionStatus)}
                  >
                    <option value="active">Aktif (Siap Diujikan)</option>
                    <option value="draft">Draf</option>
                    <option value="archived">Diarsipkan</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="q-policy">Kebijakan Penskoran</Label>
                  <Select
                    id="q-policy"
                    value={scoringPolicy}
                    disabled={questionType !== "multiple_choice"}
                    onChange={(e) => setScoringPolicy(e.target.value as ScoringPolicy)}
                  >
                    {questionType === "essay" ? (
                      <option value="manual_rubric">Penilaian Manual Guru (Rubrik)</option>
                    ) : (
                      <>
                        <option value="exact_match">Cocok Tepat (Exact Match)</option>
                        {questionType === "multiple_choice" ? (
                          <option value="partial_credit_disabled">
                            Semua Benar Tanpa Kredit Parsial
                          </option>
                        ) : null}
                      </>
                    )}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="q-topic">Topik / Kompetensi</Label>
                  <Input
                    id="q-topic"
                    placeholder="Mis. Persamaan Kuadrat"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="q-tags">Tag (pisahkan dengan koma)</Label>
                  <Input
                    id="q-tags"
                    placeholder="Mis. aljabar, kelas10, uts"
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Konten Pertanyaan</CardTitle>
                <CardDescription>
                  Mendukung rumus matematika LaTeX inline (<code>$x^2 + y^2$</code>) atau blok (
                  <code>$$\frac{"{a}"}{"{b}"}$$</code>) serta format <code>**tebal**</code>. Tag
                  HTML berbahaya otomatis disanitasi.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="q-stem">Teks Pertanyaan</Label>
                  <Textarea
                    id="q-stem"
                    rows={5}
                    placeholder="Tuliskan pertanyaan di sini..."
                    value={stem}
                    onChange={(e) => setStem(e.target.value)}
                    required
                  />
                </div>

                {stem.trim() ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Pratinjau Rumus &amp; Teks Langsung
                    </p>
                    <QuestionContentRenderer content={stem} />
                  </div>
                ) : null}

                <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
                  <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>
                    Lampiran gambar soal memerlukan penyimpanan objek cloud (Supabase Storage)
                    yang akan diaktifkan bersama konfigurasi cloud pada tahap infrastruktur.
                  </span>
                </div>
              </CardContent>
            </Card>

            {questionType !== "essay" ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle>Pilihan Jawaban &amp; Kunci</CardTitle>
                    <CardDescription>
                      {questionType === "single_choice"
                        ? "Pilih tepat 1 opsi sebagai kunci jawaban benar."
                        : questionType === "multiple_choice"
                          ? "Centang 1 atau lebih opsi yang benar."
                          : "Pilih Benar (TRUE) atau Salah (FALSE) sebagai kunci jawaban."}
                    </CardDescription>
                  </div>
                  {questionType !== "true_false" && options.length < 8 ? (
                    <Button type="button" variant="outline" size="sm" onClick={handleAddOption}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      <span>Tambah Opsi</span>
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  {options.map((opt, idx) => {
                    const isSelected = correctKeys.includes(opt.optionKey);
                    return (
                      <div
                        key={opt.optionKey}
                        className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${
                          isSelected ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type={questionType === "multiple_choice" ? "checkbox" : "radio"}
                            name="correct-option-selector"
                            aria-label={`Tandai opsi ${opt.optionKey} sebagai jawaban benar`}
                            checked={isSelected}
                            onChange={() => toggleCorrectKey(opt.optionKey)}
                            className="h-4 w-4 text-blue-700"
                          />
                          <span className="w-12 font-mono text-sm font-semibold text-slate-800">
                            {opt.optionKey}
                          </span>
                        </div>

                        <Input
                          aria-label={`Teks opsi ${opt.optionKey}`}
                          placeholder={`Isi teks opsi ${opt.optionKey}...`}
                          value={opt.optionText}
                          onChange={(e) => {
                            const val = e.target.value;
                            setOptions((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, optionText: val } : item))
                            );
                          }}
                          required
                        />

                        {questionType !== "true_false" && options.length > 2 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Hapus opsi ${opt.optionKey}`}
                            onClick={() => handleRemoveOption(idx)}
                          >
                            <Trash2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}

                  <div className="flex items-center gap-2 pt-2">
                    <input
                      id="q-preserve-opt"
                      type="checkbox"
                      checked={preserveOptionOrder}
                      onChange={(e) => setPreserveOptionOrder(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-700"
                    />
                    <Label htmlFor="q-preserve-opt">
                      Pertahankan urutan opsi (jangan acak opsi soal ini meski ujian diacak)
                    </Label>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Rubrik Penilaian Esai</CardTitle>
                  <CardDescription>
                    Soal esai selalu dinilai secara manual oleh guru setelah ujian selesai.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Label htmlFor="q-rubric">Panduan Rubrik Skor (Opsional)</Label>
                  <Textarea
                    id="q-rubric"
                    className="mt-1.5"
                    placeholder="Contoh: Langkah identifikasi (2 poin), penyelesaian akhir (3 poin)."
                    value={rubricNotes}
                    onChange={(e) => setRubricNotes(e.target.value)}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Pembahasan (Opsional)</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  aria-label="Pembahasan soal"
                  placeholder="Penjelasan langkah penyelesaian (hanya terlihat oleh guru atau setelah nilai dirilis pada fase berikutnya)."
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button asChild type="button" variant="outline">
                <Link href="/teacher/questions">Batal</Link>
              </Button>
              <Button type="submit" size="lg" disabled={saving || authorizedSubjects.length === 0}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{mode === "create" ? "Simpan Soal" : "Simpan sebagai Versi Baru"}</span>
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Simulasi Tampilan Siswa</CardTitle>
                <Badge variant="default">{points || 0} Poin</Badge>
              </div>
              <CardDescription>
                Tampilan ini menyembunyikan kunci jawaban dan pembahasan seperti saat siswa
                mengerjakan ujian.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <QuestionContentRenderer content={stem || "Pertanyaan belum diisi."} />
              </div>

              {questionType === "essay" ? (
                <Textarea disabled placeholder="Kolom jawaban esai siswa..." rows={4} />
              ) : (
                <div className="space-y-2">
                  {options.map((o) => (
                    <div
                      key={o.optionKey}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-sm"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white font-mono text-xs font-semibold">
                        {o.optionKey === "TRUE" ? "B" : o.optionKey === "FALSE" ? "S" : o.optionKey}
                      </span>
                      <QuestionContentRenderer content={o.optionText || "(Teks opsi kosong)"} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {mode === "edit" ? (
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Riwayat Revisi Soal</CardTitle>
                <CardDescription>
                  Versi sebelumnya tetap dipertahankan untuk menjaga integritas ujian yang sudah
                  diterbitkan.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {versionHistory.map((v) => (
                  <div key={v.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={v.id === ver?.id ? "success" : "neutral"}>
                        Versi v{v.version_number}
                        {v.id === ver?.id ? " (Aktif)" : ""}
                      </Badge>
                      <span className="text-xs text-slate-500">
                        {v.created_by_name ?? "Guru"} • {formatDateTimeId(v.created_at)} •{" "}
                        {v.points} poin
                      </span>
                    </div>
                    <div className="mt-2">
                      <QuestionContentRenderer content={v.stem} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
