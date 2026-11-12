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

## Phase 4 — Examination Security, Browser Integration & Real-Time Monitoring (Implemented; Live DB, Realtime & Hardware Verification Pending)

- **Scope:**
  - Real-time Teacher & Admin Control Center (`/teacher/monitoring`, `/teacher/monitoring/[examId]`, `/students/[attemptId]`, `/incidents`, `/admin/monitoring`, `/admin/monitoring/[examId]`) backed by Supabase Realtime subscriptions + 15-second polling fallback and school-isolated oversight.
  - Jittered ~30-second student presence heartbeats (`attempt_monitoring_presence`), server-inferred `CONNECTION_GAP_OBSERVED`, and bounded/deduplicated `attempt_events` batching (`record_monitoring_events_batch_atomic`, max 25 events/batch, <= 2KB metadata, server-enforced `event_source`).
  - Publish-snapshotted configurable security policies (`exam_security_policies` -> `exam_security_policy_versions`), Android ExamBro (`com.dekikurnia.exambro`) scannable SVG QR & honest `unverified_client_hint` classification, and official Safe Exam Browser (SEB) ConfigKey (`SEB-JSON` SHA-256) + Request Hash (`SHA-256(normalizedUrl + keyHex)`) verification, `.seb` profile downloads, `sebs://` deep links, and audited emergency proctor overrides (`exam_student_browser_overrides`).
  - Non-accusatory deduplicated incident workflow (`NEW -> UNDER_REVIEW -> ACKNOWLEDGED -> RESOLVED | DISMISSED`) with zero automatic penalties, prompt-only watermark/copy/context guards, formula-safe CSV monitoring export with mandatory disclaimer, privacy disclosures (`docs/EXAM_MONITORING_PRIVACY.md`), and Admin telemetry retention purge.
  - SQL migrations `000008`–`000009` and 100-student monitoring load harness (`scripts/load-test-monitoring.ts`).
- **Remaining / Live Verification Needed:** Live PostgreSQL apply & RLS/RPC verification across `000001`–`000009`, live Supabase Realtime WebSocket delivery under tenant load, physical Android ExamBro & iOS/macOS SEB handshake testing, and staging 100+ student load benchmarks.

---

## Phase 5 — Distributed Operations, Live Load Drills, Pilot & High-Stakes Launch

- **Scope:**
  - Centralized distributed rate limiting (Upstash/Redis) and structured observability ahead of multi-instance scaling.
  - Capacity and burst stress testing against live staging (200+ concurrent virtual students across login, heartbeats, telemetry batches, autosaves, and simultaneous submissions).
  - Live PostgreSQL backup/PITR restoration drills, controlled school pilot with real ExamBro/SEB hardware, MFA enforcement for staff, and formal Go / No-Go release sign-off before official school examinations.
