# Development Roadmap

Aligned with **Stage 1–6** of the *School Examination Platform — Complete Technical Blueprint*:

---

## Phase 1 — Foundation, Architecture & Deployment (Implemented; Live Cloud Verification Pending)

- **Scope:**
  - Next.js App Router modular monolith with strict TypeScript and Bahasa Indonesia UI design system.
  - Supabase Auth integration (login, logout, session refresh via `src/proxy.ts`, forgot/reset password).
  - Server-authoritative RBAC (`admin`, `teacher`, `student`) and least-privilege PostgreSQL RLS migrations (`000001`–`000003`).
  - School academic CRUD (students, teachers, teacher assignments, classes, academic years, subjects, school settings, append-only audit log viewer).
  - Automated unit, API boundary, Playwright E2E/WCAG tests, GitHub Actions CI, and Vercel deployment configuration.
- **Status:** Application code, Phase 1.5 tenant-integrity hardening migration (`000003`), unit tests, and Playwright checks pass offline; live Supabase & Vercel provisioning deferred to user cloud configuration.

---

## Phase 2 — Question Bank & Examination Management System (Implemented; Live PostgreSQL Verification Pending)

- **Scope:**
  - Complete Question Bank module: `single_choice`, `multiple_choice`, `true_false`, and manual-rubric `essay` questions; immutable `question_versions`; separated `question_answer_keys`; Safe KaTeX rendering (`trust: false`); attachment metadata placeholder; CSV & `.xlsx` bulk import with preview, formula/XSS safety, duplicate detection, and atomic commit (`import_questions_atomic`).
  - Complete Examination Management workflow: draft builder (`exam_draft_questions`) with ordering, point overrides, and pinning; UTC class schedules & cross-exam overlap detection; optimistic concurrency (`version_lock`); readiness validation checklist; student-safe (`mode=student`) and teacher-review (`mode=teacher`) previews with responsive mobile (`390px`) / desktop inspection.
  - Immutable Examination Publishing & Revision Lifecycle (`DRAFT` -> `READY_FOR_REVIEW` -> `PUBLISHED` -> `CLOSED` / `ARCHIVED`, plus explicit `PUBLISHED -> DRAFT` revision via `start_exam_revision`) powered by `publish_exam_atomic`, producing frozen `exam_versions`, `exam_version_questions`, and isolated `exam_version_answer_keys` ready for Phase 3.
  - Administrator exam oversight (`/admin/exams`, `ADMIN_CLOSED`, `ADMIN_ARCHIVED`).
- **Status:** Application code, SQL migrations `000004`–`000005`, offline Vitest suite, and Playwright E2E checks implemented and passing locally. **Live PostgreSQL execution of migrations `000003`–`000005` and live RLS policy tests require connecting a live Supabase/PostgreSQL instance.**

---

## Phase 3 — Student Examination Engine & Grading (Implemented; Live PostgreSQL & Device Verification Pending)

- **Scope:**
  - Authoritative student attempt engine (`/student/exams`, `/student/exams/[examId]/instructions`, `/student/attempts/[attemptId]`, `/review`, `/receipt`, `/student/results`):
    - Idempotent `start_or_resume_exam_attempt` RPC with `idx_exam_attempts_single_active` concurrency guard and deterministic shuffled realization (`attempt_question_assignments`).
    - Idempotent answer autosave API (`PUT /answers` -> `save_attempt_answer_atomic`) with monotonic revision checks, option-key translation, and IndexedDB pending recovery queue (`src/lib/exam-storage.ts`).
    - Explicit UI sync states (`Menyimpan...`, `Tersimpan`, `Menunggu koneksi`, `Sinkronisasi diperlukan`, `Gagal menyimpan`) backed strictly by PostgreSQL acknowledgments.
    - Dedicated review checklist (`/review`) separated from question navigation, transactional finalization (`_finalize_attempt_internal`), and immutable `SubmissionReceipt`.
  - Objective server-side grading (`_compute_and_upsert_exam_grade`), teacher manual essay grading workspace (`/teacher/grading`, `/teacher/exams/[id]/grading`), audited post-grading score adjustments (`grade_adjustments`), configurable result release policies (`manual`, `after_submit_if_no_essay`, `after_window_close`), and admin audited attempt cancellation (`cancel_exam_attempt_by_admin`).
  - Reproducible 100-student load test harness (`scripts/load-test-exam-engine.ts`).
- **Remaining / Live Verification Needed:** Real PostgreSQL execution of `000006`–`000007` RPCs and RLS suites, real-device Android **ExamBro** & **Safe Exam Browser (SEB)** iOS ConfigKey/BrowserExamKey enforcement verification, live proctor room coordination (`exam_coordinator`, `proctor`, `auditor`), and executing the isolated load test benchmark.

---

## Phase 4 — Operations, Load Testing, Pilot & High-Stakes Launch

- **Scope:**
  - Centralized rate limiting and observability (structured logs, error tracking, metrics).
  - Capacity and burst stress testing (target: simulate at least 2x expected ~100 concurrent candidates = 200+ concurrent virtual students performing login bursts, autosaves, and simultaneous final submissions).
  - Backup restoration drills (PostgreSQL WAL/PITR verification on Supabase Pro or dedicated PostgreSQL).
  - Low-stakes controlled school pilot and formal Go / No-Go release checklist sign-off before official school examinations.
