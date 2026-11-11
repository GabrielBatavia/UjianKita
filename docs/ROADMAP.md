# Development Roadmap

Aligned with **Stage 1–6** of the *School Examination Platform — Complete Technical Blueprint*:

---

## Phase 1 — Foundation, Architecture & Deployment (Current Phase)

- **Scope:**
  - Next.js App Router modular monolith with strict TypeScript and Bahasa Indonesia UI design system.
  - Supabase Auth integration (login, logout, session refresh via `src/proxy.ts`, forgot/reset password).
  - Server-authoritative RBAC (`admin`, `teacher`, `student`) and least-privilege PostgreSQL RLS migrations.
  - School academic CRUD (students, teachers, teacher assignments, classes, academic years, subjects, school settings, append-only audit log viewer).
  - Honest Phase 2 placeholders (zero fabricated grades or exam data).
  - Automated unit, API boundary, Playwright E2E/WCAG tests, GitHub Actions CI, and Vercel deployment configuration.
- **Exit Evidence:** Passing CI checks, reviewed SQL schema & RLS policies, ExamBro/SEB research documentation, live deployed preview verification.

---

## Phase 2 — Examination Core (Question Bank, Exam Engine & Grading)

- **Scope:**
  - Question bank module with version history, LaTeX math, protected media attachments, and strict answer-key isolation.
  - Examination builder with eligibility, server-controlled start/end/deadline UTC timestamps, randomization seeds, and immutable published `exam_versions`.
  - Authoritative student attempt engine:
    - Idempotent `PUT /api/attempts/[id]/answers/[questionId]` with monotonic revision checking and PostgreSQL commit acknowledgments.
    - Explicit UI sync states (`Menyimpan...`, `Jawaban tersimpan`, `Koneksi terputus — X jawaban tertunda`, `Menyambung ulang...`).
    - Recovery after page reload / phone restart and deterministic deadline handling.
    - Transactional final submission with atomic `SubmissionReceipt`.
  - Objective server-side grading, teacher essay rubric grading, and audited grade adjustment workflow (`reason` + approver).
  - Enable `exam_coordinator` role workflow for exam publishing approval.
- **Exit Evidence:** Concurrency/race-condition test suite, grading accuracy fixture suite, recovery after interrupted network/reload E2E tests.

---

## Phase 3 — Exam Browser Integration & Live Supervision

- **Scope:**
  - Real-device evaluation and selection of exact Android **ExamBro** publisher/package/version.
  - Integration with **Safe Exam Browser (SEB)** iOS JavaScript API (`SafeExamBrowser.security.updateKeys`) and server-side ConfigKey/BrowserExamKey verification.
  - Live examination monitoring dashboard for teachers/proctors (heartbeat tracking, progress counters, evidence-based event timeline, incident notes, documented time-extension workflows).
  - Activate `proctor` and `auditor` roles.
- **Exit Evidence:** Device compatibility matrix signed off on target Android & iOS models; real-device ExamBro & SEB launch/lockdown/recovery evidence.

---

## Phase 4 — Operations, Load Testing, Pilot & High-Stakes Launch

- **Scope:**
  - Centralized rate limiting and observability (structured logs, error tracking, metrics).
  - Capacity and burst stress testing (target: simulate at least 2x expected ~100 concurrent candidates = 200+ concurrent virtual students performing login bursts, autosaves, and simultaneous final submissions).
  - Backup restoration drills (PostgreSQL WAL/PITR verification on Supabase Pro or dedicated PostgreSQL).
  - Low-stakes controlled school pilot and formal Go / No-Go release checklist sign-off before official school examinations.
