"use client";

import * as React from "react";
import {
  BookOpen,
  CheckCircle2,
  Database,
  FileCheck2,
  GraduationCap,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import type {
  StudentAttemptWorkspacePayload,
  StudentSubmissionReceiptDetail,
  StudentExamAvailabilityItem,
} from "@/domain/exams/phase3-types";
import type { QuestionRecord } from "@/domain/exams/phase2-types";
import type { StudentRecord, ClassroomRecord } from "@/domain/academic/types";
import { createDefaultSecurityPolicy } from "@/domain/monitoring/phase4-types";
import type { ExamControlCenterPayload } from "@/components/features/monitoring/teacher-exam-control-center";
import { ExamPlayerClient } from "@/components/features/student/exam-player-client";
import { StudentAttemptReview } from "@/components/features/student/student-attempt-review";
import { StudentSubmissionReceiptView } from "@/components/features/student/student-submission-receipt";
import { StudentExamInstructions } from "@/components/features/student/student-exam-instructions";
import { QuestionBankList } from "@/components/features/teacher/question-bank-list";
import { StudentsManager } from "@/components/features/admin/students-manager";
import { TeacherExamControlCenter } from "@/components/features/monitoring/teacher-exam-control-center";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MOCK_WORKSPACE: StudentAttemptWorkspacePayload = {
  attempt: {
    id: "mock-attempt-1",
    schoolId: "mock-school-1",
    examId: "mock-exam-1",
    examVersionId: "mock-version-1",
    studentId: "mock-student-1",
    classId: "mock-class-1",
    attemptNumber: 1,
    status: "IN_PROGRESS",
    startedAtUtc: new Date(Date.now() - 15 * 60_000).toISOString(),
    deadlineAtUtc: new Date(Date.now() + 45 * 60_000).toISOString(),
    submittedAtUtc: null,
    lastActivityAtUtc: new Date().toISOString(),
    timeExtensionMinutes: 0,
    cancellationReason: null,
    cancelledBy: null,
    cancelledAtUtc: null,
  },
  examTitle: "Penilaian Tengah Semester — Matematika Lanjutan",
  subjectName: "Matematika",
  instructions: "Bacalah setiap butir soal dengan saksama. Periksa kembali jawaban sebelum mengumpulkan.",
  durationMinutes: 60,
  requireExamBrowser: false,
  serverNowUtc: new Date().toISOString(),
  remainingMs: 45 * 60_000,
  questions: [
    {
      attemptQuestionId: "q-1",
      displayIndex: 1,
      questionType: "single_choice",
      stem: "Tentukan turunan pertama dari fungsi kuadrat $f(x) = 3x^2 + 5x - 7$ pada titik $x$!",
      points: 25,
      options: [
        { optionKey: "A", optionText: "$f'(x) = 6x + 5$", displayOrder: 0 },
        { optionKey: "B", optionText: "$f'(x) = 3x + 5$", displayOrder: 1 },
        { optionKey: "C", optionText: "$f'(x) = 6x - 7$", displayOrder: 2 },
        { optionKey: "D", optionText: "$f'(x) = 5x + 3$", displayOrder: 3 },
      ],
      currentResponse: {
        questionType: "single_choice",
        selectedOptionKey: "A",
      },
      latestRevision: 1,
      isFlaggedForReview: false,
      committedAtUtc: new Date().toISOString(),
    },
    {
      attemptQuestionId: "q-2",
      displayIndex: 2,
      questionType: "multiple_choice",
      stem: "Pilih semua besaran turunan berikut yang diturunkan dari besaran pokok panjang dan waktu:",
      points: 35,
      options: [
        { optionKey: "A", optionText: "Kecepatan ($v = \\frac{s}{t}$ dengan satuan $m/s$)", displayOrder: 0 },
        { optionKey: "B", optionText: "Percepatan ($a = \\frac{\\Delta v}{\\Delta t}$ dengan satuan $m/s^2$)", displayOrder: 1 },
        { optionKey: "C", optionText: "Massa jenis ($\\rho = \\frac{m}{V}$)", displayOrder: 2 },
        { optionKey: "D", optionText: "Gaya ($F = m \\cdot a$)", displayOrder: 3 },
      ],
      currentResponse: {
        questionType: "multiple_choice",
        selectedOptionKeys: ["A", "B"],
      },
      latestRevision: 1,
      isFlaggedForReview: true,
      committedAtUtc: new Date().toISOString(),
    },
    {
      attemptQuestionId: "q-3",
      displayIndex: 3,
      questionType: "essay",
      stem: "Jelaskan prinsip kerja dari rumus integral tak tentu $\\int x^n \\, dx = \\frac{1}{n+1} x^{n+1} + C$ untuk $n \\neq -1$ beserta contoh penerapannya dalam menghitung luas daerah di bawah kurva!",
      points: 40,
      options: [],
      currentResponse: {
        questionType: "essay",
        textAnswer: "Integral tak tentu merupakan antiturunan. Jika f(x) diturunkan menjadi f'(x), maka proses mengembalikan f'(x) ke f(x) menggunakan kaidah antiturunan dengan konstanta integrasi C.",
      },
      latestRevision: 1,
      isFlaggedForReview: false,
      committedAtUtc: new Date().toISOString(),
    },
  ],
};

const MOCK_RECEIPT: StudentSubmissionReceiptDetail = {
  receiptId: "rcpt-2026-demo-84920",
  receiptCode: "RCPT-84920-MAT",
  attemptId: "mock-attempt-1",
  examId: "mock-exam-1",
  examVersionId: "mock-version-1",
  examTitle: "Penilaian Tengah Semester — Matematika Lanjutan",
  subjectName: "Matematika",
  studentName: "Ahmad Rizky Pratama",
  studentNis: "2026010042",
  className: "XII MIPA 1",
  attemptNumber: 1,
  attemptStatus: "SUBMITTED",
  startedAtUtc: new Date(Date.now() - 55 * 60_000).toISOString(),
  submittedAtUtc: new Date().toISOString(),
  answeredCount: 3,
  totalQuestions: 3,
  integrityDigest: "e2e8f0a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890",
  resultReleasePolicy: "manual",
  gradingStatus: "PENDING_MANUAL_REVIEW",
  releaseStatus: "UNRELEASED",
  canViewResultNow: false,
};

const MOCK_INSTRUCTIONS_EXAM: StudentExamAvailabilityItem = {
  examId: "mock-exam-1",
  title: "Penilaian Tengah Semester — Matematika Lanjutan",
  description: "Ujian tertulis resmi semester ganjil berbasis web aman.",
  instructions: "1. Pastikan baterai ponsel terisi minimal 50%.\n2. Waktu ujian dihitung mundur otomatis dari server.\n3. Jangan menutup atau beralih aplikasi selama pengerjaan.",
  subjectId: "sb-1",
  subjectName: "Matematika",
  subjectCode: "MAT",
  classId: "cls-1",
  className: "XII MIPA 1",
  examStatus: "PUBLISHED",
  publishedVersionId: "mock-ver-1",
  durationMinutes: 60,
  maxAttempts: 1,
  passingScore: 75,
  lateJoinMinutes: 15,
  requireExamBrowser: false,
  randomizeQuestions: false,
  randomizeOptions: false,
  resultReleasePolicy: "manual",
  resultsReleasedAt: null,
  startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
  questionCount: 3,
  totalPoints: 100,
  category: "tersedia",
  reasonCode: "AVAILABLE_TO_START",
  statusMessage: "Ujian siap dimulai.",
  canStart: true,
  canResume: false,
  attemptsUsed: 0,
  activeAttemptId: null,
  latestAttemptId: null,
  latestAttemptStatus: null,
  latestReceiptCode: null,
  canViewReceipt: false,
  canViewResult: false,
};

const MOCK_QUESTIONS: QuestionRecord[] = [
  {
    id: "q-rec-1",
    school_id: "sch-1",
    question_bank_id: "qb-1",
    subject_id: "sb-1",
    subject_name: "Matematika",
    created_by: "usr-1",
    current_version_id: "qv-1",
    question_type: "single_choice",
    difficulty: "medium",
    topic: "Turunan dan Diferensial",
    tags: ["kalkulus", "aljabar"],
    status: "active",
    attachment_metadata: [],
    content_fingerprint: "fp-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_version: {
      id: "qv-1",
      question_id: "q-rec-1",
      version_number: 1,
      stem: "Tentukan turunan pertama dari fungsi $f(x) = 3x^2 + 5x - 7$!",
      explanation: "Gunakan aturan pangkat: d/dx(x^n) = n*x^(n-1).",
      points: 25,
      scoring_policy: "exact_match",
      rubric_notes: null,
      preserve_option_order: false,
      created_by: "usr-1",
      options: [
        { optionKey: "A", optionText: "6x + 5", displayOrder: 0 },
        { optionKey: "B", optionText: "3x + 5", displayOrder: 1 },
      ],
      correct_option_keys: ["A"],
      created_at: new Date().toISOString(),
    },
  },
  {
    id: "q-rec-2",
    school_id: "sch-1",
    question_bank_id: "qb-1",
    subject_id: "sb-1",
    subject_name: "Fisika",
    created_by: "usr-1",
    current_version_id: "qv-2",
    question_type: "multiple_choice",
    difficulty: "easy",
    topic: "Besaran dan Satuan",
    tags: ["dasar-fisika"],
    status: "active",
    attachment_metadata: [],
    content_fingerprint: "fp-2",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_version: {
      id: "qv-2",
      question_id: "q-rec-2",
      version_number: 2,
      stem: "Pilih semua besaran turunan dari besaran pokok panjang dan waktu:",
      explanation: "Kecepatan dan percepatan adalah turunan dari m dan s.",
      points: 35,
      scoring_policy: "exact_match",
      rubric_notes: null,
      preserve_option_order: true,
      created_by: "usr-1",
      options: [
        { optionKey: "A", optionText: "Kecepatan (m/s)", displayOrder: 0 },
        { optionKey: "B", optionText: "Percepatan (m/s²)", displayOrder: 1 },
      ],
      correct_option_keys: ["A", "B"],
      created_at: new Date().toISOString(),
    },
  },
];

const MOCK_STUDENTS: StudentRecord[] = [
  {
    id: "stu-1",
    school_id: "sch-1",
    user_id: "usr-1",
    nis: "2026010042",
    nisn: "0081234567",
    full_name: "Ahmad Rizky Pratama",
    email: "ahmad.rizky@sekolah.sch.id",
    gender: "L",
    phone: "081234567890",
    guardian_name: "Bambang Pratama",
    guardian_phone: "081298765432",
    current_class_id: "cls-1",
    current_class_name: "XII MIPA 1",
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "stu-2",
    school_id: "sch-1",
    user_id: "usr-2",
    nis: "2026010043",
    nisn: "0081234568",
    full_name: "Siti Nurhaliza",
    email: "siti.nurhaliza@sekolah.sch.id",
    gender: "P",
    phone: "081234567891",
    guardian_name: "Nur Hasanah",
    guardian_phone: "081298765433",
    current_class_id: "cls-1",
    current_class_name: "XII MIPA 1",
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_CLASSES: ClassroomRecord[] = [
  {
    id: "cls-1",
    school_id: "sch-1",
    academic_year_id: "ay-1",
    name: "XII MIPA 1",
    grade_level: "XII",
    program: "MIPA",
    homeroom_teacher_id: null,
    academic_year_name: "2026/2027 Ganjil",
    capacity: 36,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const MOCK_MONITORING: ExamControlCenterPayload = {
  exam: {
    examId: "mock-exam-1",
    title: "Penilaian Tengah Semester — Matematika Lanjutan",
    subjectName: "Matematika",
    startsAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    questionCount: 3,
  },
  policy: createDefaultSecurityPolicy({ examId: "mock-exam-1", schoolId: "sch-1" }),
  summary: {
    totalAssigned: 32,
    notStartedCount: 1,
    inProgressCount: 28,
    submittedCount: 3,
    expiredCount: 0,
    recentlySeenCount: 27,
    staleCount: 1,
    unknownPresenceCount: 1,
    reviewRequiredCount: 0,
    openIncidentCount: 0,
    sebVerifiedCount: 0,
    exambroHintCount: 14,
  },
  alerts: [],
  students: [
    {
      attemptId: "mock-attempt-1",
      studentId: "stu-1",
      studentName: "Ahmad Rizky Pratama",
      studentNis: "2026010042",
      classId: "cls-1",
      className: "XII MIPA 1",
      attemptStatus: "IN_PROGRESS",
      presenceState: "RECENTLY_SEEN",
      lastHeartbeatAt: new Date().toISOString(),
      secondsSinceLastHeartbeat: 4,
      startedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      effectiveDeadlineAt: new Date(Date.now() + 45 * 60_000).toISOString(),
      submittedAt: null,
      answeredCount: 3,
      totalQuestions: 3,
      progressPercent: 100,
      browserPlatform: "STANDARD_WEB",
      browserTrustLevel: "standard_browser",
      visibilityHiddenCount: 0,
      reloadCount: 0,
      connectionGapCount: 0,
      copyPasteCount: 0,
      contextMenuCount: 0,
      highestSeverity: "INFORMATIONAL",
      openIncidentCount: 0,
      hasManualOverride: false,
    },
    {
      attemptId: "mock-attempt-2",
      studentId: "stu-2",
      studentName: "Siti Nurhaliza",
      studentNis: "2026010043",
      classId: "cls-1",
      className: "XII MIPA 1",
      attemptStatus: "IN_PROGRESS",
      presenceState: "STALE",
      lastHeartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      secondsSinceLastHeartbeat: 60,
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      effectiveDeadlineAt: new Date(Date.now() + 40 * 60_000).toISOString(),
      submittedAt: null,
      answeredCount: 2,
      totalQuestions: 3,
      progressPercent: 66,
      browserPlatform: "ANDROID_EXAMBRO",
      browserTrustLevel: "unverified_client_hint",
      visibilityHiddenCount: 2,
      reloadCount: 1,
      connectionGapCount: 1,
      copyPasteCount: 0,
      contextMenuCount: 0,
      highestSeverity: "WARNING",
      openIncidentCount: 1,
      hasManualOverride: false,
    },
  ],
  totalFilteredStudents: 2,
  page: 1,
  pageSize: 20,
  incidents: [],
  generatedAt: new Date().toISOString(),
};

type PreviewTab =
  | "exam-player"
  | "instructions"
  | "review"
  | "receipt"
  | "question-bank"
  | "admin-students"
  | "monitoring";

export function DevPreviewClient() {
  const [activeTab, setActiveTab] = React.useState<PreviewTab>("exam-player");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Dev preview switcher bar */}
      <nav
        aria-label="Panel Pengujian Visual"
        className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs font-bold">
              UI Sandbox &amp; QA
            </Badge>
            <span className="text-xs text-slate-600 hidden sm:inline">
              Data Sintetis untuk Verifikasi Visual Lintas Perangkat
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 overflow-x-auto text-xs">
            <Button
              size="sm"
              variant={activeTab === "exam-player" ? "default" : "outline"}
              onClick={() => setActiveTab("exam-player")}
              className="text-xs"
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Exam Player</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "instructions" ? "default" : "outline"}
              onClick={() => setActiveTab("instructions")}
              className="text-xs"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Instruksi</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "review" ? "default" : "outline"}
              onClick={() => setActiveTab("review")}
              className="text-xs"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tinjauan Jawaban</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "receipt" ? "default" : "outline"}
              onClick={() => setActiveTab("receipt")}
              className="text-xs"
            >
              <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Bukti Pengumpulan</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "question-bank" ? "default" : "outline"}
              onClick={() => setActiveTab("question-bank")}
              className="text-xs"
            >
              <Database className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Bank Soal</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "admin-students" ? "default" : "outline"}
              onClick={() => setActiveTab("admin-students")}
              className="text-xs"
            >
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Data Siswa</span>
            </Button>
            <Button
              size="sm"
              variant={activeTab === "monitoring" ? "default" : "outline"}
              onClick={() => setActiveTab("monitoring")}
              className="text-xs"
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Monitoring</span>
            </Button>
          </div>
        </div>
      </nav>

      {/* Render Component */}
      <main className="min-h-[calc(100vh-50px)]">
        {activeTab === "exam-player" && (
          <ExamPlayerClient
            initialWorkspace={MOCK_WORKSPACE}
            securityPolicy={{
              examId: "mock-exam-1",
              examTitle: "Penilaian Tengah Semester",
              browserPolicy: "STANDARD_BROWSER_ALLOWED",
              exambroEnabled: true,
              exambroMinAppHint: "2.0.0",
              sebEnabled: false,
              sebJsApiVerificationRequired: false,
              sebVerifiedForAttempt: false,
              hasActiveStaffOverride: false,
              overrideReason: null,
              copyPasteGuardEnabled: true,
              contextMenuGuardEnabled: true,
              watermarkEnabled: true,
              watermarkOpacity: 0.08,
              heartbeatIntervalSeconds: 15,
              privacyNoticeText: "Ujian diawasi secara digital.",
              sebConfigDownloadUrl: "#",
              sebLaunchUrl: "#",
            }}
            studentDisplayName="Ahmad Rizky Pratama"
          />
        )}

        {activeTab === "instructions" && (
          <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <StudentExamInstructions
              exam={MOCK_INSTRUCTIONS_EXAM}
              timeZone="Asia/Jakarta"
            />
          </div>
        )}

        {activeTab === "review" && (
          <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <StudentAttemptReview workspace={MOCK_WORKSPACE} />
          </div>
        )}

        {activeTab === "receipt" && (
          <div className="p-4 sm:p-6 max-w-4xl mx-auto">
            <StudentSubmissionReceiptView
              receipt={MOCK_RECEIPT}
              timeZone="Asia/Jakarta"
            />
          </div>
        )}

        {activeTab === "question-bank" && (
          <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <QuestionBankList
              initialQuestions={MOCK_QUESTIONS}
              total={MOCK_QUESTIONS.length}
              page={1}
              pageSize={10}
              authorizedSubjects={[{ id: "sb-1", code: "MAT", name: "Matematika" }]}
              initialFilters={{}}
            />
          </div>
        )}

        {activeTab === "admin-students" && (
          <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <StudentsManager
              initialStudents={MOCK_STUDENTS}
              classes={MOCK_CLASSES}
              serviceRoleConfigured={true}
            />
          </div>
        )}

        {activeTab === "monitoring" && (
          <div className="p-4 sm:p-6 max-w-6xl mx-auto">
            <TeacherExamControlCenter
              initialData={MOCK_MONITORING}
              basePath="/teacher/monitoring"
              timeZone="Asia/Jakarta"
            />
          </div>
        )}
      </main>
    </div>
  );
}
