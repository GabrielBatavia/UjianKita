"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Monitor,
  Smartphone,
} from "lucide-react";
import type {
  StudentExamPreviewPayload,
  TeacherExamReviewPayload,
  TeacherReviewPreviewQuestion,
} from "@/domain/exams/phase2-types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { QuestionContentRenderer } from "@/components/features/exams/question-content-renderer";

export function ExamPreviewClient({
  examId,
  initialStudentPayload,
  backHref,
}: {
  examId: string;
  initialStudentPayload: StudentExamPreviewPayload;
  backHref: string;
}) {
  const [viewportMode, setViewportMode] = React.useState<"mobile" | "desktop">("mobile");
  const [audienceMode, setAudienceMode] = React.useState<"student" | "teacher">("student");
  const [teacherPayload, setTeacherPayload] = React.useState<TeacherExamReviewPayload | null>(null);
  const [loadingTeacherMode, setLoadingTeacherMode] = React.useState(false);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [previewAnswers, setPreviewAnswers] = React.useState<Record<string, string[]>>({});

  async function switchAudience(next: "student" | "teacher") {
    setAudienceMode(next);
    if (next === "teacher" && !teacherPayload) {
      setLoadingTeacherMode(true);
      try {
        const res = await fetch(`/api/teacher/exams/${examId}/preview?mode=teacher`);
        if (res.ok) {
          const data = (await res.json()) as TeacherExamReviewPayload;
          setTeacherPayload(data);
        }
      } finally {
        setLoadingTeacherMode(false);
      }
    }
  }

  const activePayload =
    audienceMode === "teacher" && teacherPayload ? teacherPayload : initialStudentPayload;

  const currentQuestion = activePayload.questions[currentIndex];
  const teacherQuestion =
    audienceMode === "teacher" && teacherPayload
      ? (teacherPayload.questions[currentIndex] as TeacherReviewPreviewQuestion | undefined)
      : undefined;

  function selectAnswer(questionId: string, optionKey: string, isMultiple: boolean) {
    setPreviewAnswers((prev) => {
      const existing = prev[questionId] ?? [];
      if (!isMultiple) {
        return { ...prev, [questionId]: [optionKey] };
      }
      const next = existing.includes(optionKey)
        ? existing.filter((k) => k !== optionKey)
        : [...existing, optionKey];
      return { ...prev, [questionId]: next };
    });
  }

  const answeredCount = activePayload.questions.filter(
    (q) => (previewAnswers[q.questionId]?.length ?? 0) > 0
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Kembali</span>
            </Link>
          </Button>
          <div>
            <Badge variant={activePayload.source === "published_snapshot" ? "success" : "default"}>
              {activePayload.source === "published_snapshot"
                ? `Snapshot Terpublikasi v${activePayload.versionNumber}`
                : "Pratinjau Draf"}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewportMode("mobile")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                viewportMode === "mobile"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Ponsel (390px)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode("desktop")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                viewportMode === "desktop"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Desktop</span>
            </button>
          </div>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => switchAudience("student")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                audienceMode === "student"
                  ? "bg-white text-blue-800 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              Tampilan Siswa (Aman)
            </button>
            <button
              type="button"
              onClick={() => switchAudience("teacher")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                audienceMode === "teacher"
                  ? "bg-white text-blue-800 shadow-xs"
                  : "text-slate-600"
              }`}
            >
              Tinjauan Guru (Kunci)
            </button>
          </div>
        </div>
      </div>

      <Alert variant="info" title="Mode Pratinjau Ujian">
        {audienceMode === "student"
          ? "Payload tampilan siswa tidak menyertakan kunci jawaban atau pembahasan. Simulasi ini tidak membuat percobaan atau nilai nyata."
          : "Mode Tinjauan Guru menampilkan kunci jawaban, kebijakan penskoran, dan pembahasan untuk verifikasi sebelum publikasi."}
      </Alert>

      {loadingTeacherMode ? (
        <p className="text-sm text-slate-600">Memuat data tinjauan guru...</p>
      ) : null}

      {/* Preview Frame */}
      <div
        data-testid="exam-preview-frame"
        className={`mx-auto rounded-2xl border border-slate-300 bg-slate-50 shadow-sm transition-all ${
          viewportMode === "mobile" ? "max-w-[390px]" : "w-full max-w-4xl"
        }`}
      >
        {/* Simulated Student Top Bar */}
        <div className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{activePayload.title}</p>
            <p className="text-xs text-slate-500">
              {activePayload.subjectName} • Soal {activePayload.totalQuestions > 0 ? currentIndex + 1 : 0} /{" "}
              {activePayload.totalQuestions}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-mono font-semibold text-blue-800">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{activePayload.durationMinutes}:00</span>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {activePayload.instructions && currentIndex === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600 leading-relaxed">
              <p className="font-semibold text-slate-900 mb-1">Petunjuk Ujian:</p>
              <p>{activePayload.instructions}</p>
            </div>
          ) : null}

          {activePayload.totalQuestions === 0 || !currentQuestion ? (
            <Card>
              <CardHeader>
                <CardTitle>Belum Ada Soal Terpilih</CardTitle>
                <CardDescription>
                  Tambahkan soal pada tab Pemilihan Soal untuk melihat pratinjau ujian.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="default">Nomor {currentQuestion.index}</Badge>
                  <span className="font-mono text-xs text-slate-500">
                    {currentQuestion.points} poin
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <QuestionContentRenderer content={currentQuestion.stem} />

                {currentQuestion.questionType === "essay" ? (
                  <Textarea
                    rows={5}
                    placeholder="Area jawaban esai siswa (hanya simulasi pratinjau)..."
                    value={previewAnswers[currentQuestion.questionId]?.[0] ?? ""}
                    onChange={(e) =>
                      setPreviewAnswers((prev) => ({
                        ...prev,
                        [currentQuestion.questionId]: e.target.value ? [e.target.value] : [],
                      }))
                    }
                  />
                ) : (
                  <div className="space-y-2.5">
                    {currentQuestion.options.map((opt) => {
                      const selected = (previewAnswers[currentQuestion.questionId] ?? []).includes(
                        opt.optionKey
                      );
                      const isCorrect =
                        teacherQuestion?.correctOptionKeys.includes(opt.optionKey) ?? false;

                      return (
                        <button
                          key={opt.optionKey}
                          type="button"
                          onClick={() =>
                            selectAnswer(
                              currentQuestion.questionId,
                              opt.optionKey,
                              currentQuestion.questionType === "multiple_choice"
                            )
                          }
                          className={`flex min-h-[48px] w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm transition-colors cursor-pointer ${
                            isCorrect
                              ? "border-emerald-400 bg-emerald-50/70"
                              : selected
                                ? "border-blue-600 bg-blue-50/70"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold ${
                              selected
                                ? "border-blue-700 bg-blue-700 text-white"
                                : "border-slate-300 bg-white text-slate-700"
                            }`}
                          >
                            {opt.optionKey === "TRUE"
                              ? "B"
                              : opt.optionKey === "FALSE"
                                ? "S"
                                : opt.optionKey}
                          </span>
                          <div className="flex-1">
                            <QuestionContentRenderer content={opt.optionText} />
                          </div>
                          {isCorrect ? (
                            <CheckCircle2
                              className="mt-1 h-4 w-4 shrink-0 text-emerald-700"
                              aria-label="Kunci jawaban benar"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}

                {teacherQuestion ? (
                  <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-emerald-900">
                      Kebijakan Skor: {teacherQuestion.scoringPolicy}
                    </p>
                    {teacherQuestion.rubricNotes ? (
                      <p>Rubrik: {teacherQuestion.rubricNotes}</p>
                    ) : null}
                    {teacherQuestion.explanation ? (
                      <div>
                        <span className="font-semibold">Pembahasan:</span>
                        <QuestionContentRenderer content={teacherQuestion.explanation} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Question Navigator & Progress */}
          {activePayload.totalQuestions > 0 ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  Terisi (simulasi): {answeredCount} / {activePayload.totalQuestions}
                </span>
                <span>Total Poin: {activePayload.totalPoints}</span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {activePayload.questions.map((q, idx) => {
                  const isActive = idx === currentIndex;
                  const isAnswered = (previewAnswers[q.questionId]?.length ?? 0) > 0;
                  return (
                    <button
                      key={q.questionId}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      className={`h-9 min-w-[36px] rounded-lg border px-2 font-mono text-xs font-semibold cursor-pointer ${
                        isActive
                          ? "border-blue-700 bg-blue-700 text-white"
                          : isAnswered
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  <span>Sebelumnya</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={currentIndex >= activePayload.totalQuestions - 1}
                  onClick={() =>
                    setCurrentIndex((i) => Math.min(activePayload.totalQuestions - 1, i + 1))
                  }
                >
                  <span>Berikutnya</span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
