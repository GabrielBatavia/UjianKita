# UjianKita

**UjianKita** is a web-first Computer-Based Testing (CBT) platform designed for official school examinations on students' personal Android phones (via **ExamBro**) and iPhones (via **Safe Exam Browser / SEB**), paired with web workspaces for school administrators and teachers.

> **Current Stage — Phase A (Complete UI/UX Modernization, Design System & Mobile-First Compatibility):**
> Following Phases 1–6.5 (which delivered the complete Next.js 16 + Supabase PostgreSQL CBT application engine, immutable exam versioning, authoritative timer and autosave logic, and production cutover), Phase A modernizes the entire interface into a polished, accessible, mobile-first SaaS platform. With Phase 7 postponed, Phase A elevates student examination ergonomics on smartphones (320px–430px viewports), standardizes a WCAG 2.1 AA compliant design system with semantic tokens, eliminates iOS Safari auto-zoom quirks, implements adaptive table-to-card transformations across teacher/admin management rosters, and establishes a mobile slide-over drawer and student bottom navigation with hardware safe-area padding (`pb-safe`).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router, `src/proxy.ts`) |
| Language | TypeScript (`strict: true`) |
| Styling & UI | Tailwind CSS v4 + Radix UI / shadcn-style accessible primitives |
| Database & Auth | Supabase PostgreSQL + Supabase Auth (`@supabase/ssr`) |
| Validation & Parsing | Zod + PapaParse + ExcelJS + KaTeX |
| Testing | Vitest + React Testing Library + Playwright + `@axe-core/playwright` |
| Hosting & CI | Vercel + GitHub Actions |

---

## Local Development Setup

### Prerequisites

- Node.js 22+ (LTS recommended) and `npm`
- Git
- A Supabase project (cloud or local Supabase CLI with Docker)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Required variables:

- `NEXT_PUBLIC_APP_URL` — e.g. `http://localhost:3000`
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase public anon/publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — Server-only key used exclusively for administrative user provisioning (`never` prefix with `NEXT_PUBLIC_`)

### 3. Apply Database Migrations

Apply the SQL migrations in `supabase/migrations/` in chronological order:

1. `20261112000001_phase1_foundation_schema.sql`
2. `20261112000002_phase1_rls_and_functions.sql`
3. `20261112000003_phase1_5_hardening.sql`
4. `20261112000004_phase2_question_bank_and_exams.sql`
5. `20261112000005_phase2_rls_and_publish_rpc.sql`
6. `20261112000006_phase3_attempt_and_grading_schema.sql`
7. `20261112000007_phase3_rls_and_attempt_rpcs.sql`
8. `20261112000008_phase4_security_monitoring_schema.sql`
9. `20261112000009_phase4_rls_and_monitoring_rpcs.sql`
10. `20261112000010_phase5_security_and_rpc_hardening.sql`

For non-production local testing, you may also run `supabase/seed.sql` or execute `npx tsx scripts/bootstrap-synthetic-school.ts` against a non-production Supabase instance to provision isolated synthetic test accounts.

### 4. Run the Development Server

```bash
npm run dev
```

Open `http://localhost:3000`. Health check telemetry is exposed at `GET /api/health`.

### 5. Verification Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

---

## Documentation Index

### Phase A — UI/UX Modernization, Design System & Mobile Compatibility
- [`docs/PHASE_A_UI_UX_AUDIT.md`](docs/PHASE_A_UI_UX_AUDIT.md) — Comprehensive pre-redesign audit, issue inventory, and design evaluations
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — Design system specification, semantic color tokens, typography scale, and components
- [`docs/MOBILE_COMPATIBILITY.md`](docs/MOBILE_COMPATIBILITY.md) — Mobile web compatibility, viewport matrix (320px–1440px), safe areas, and quirks handling
- [`docs/STUDENT_EXAM_UX.md`](docs/STUDENT_EXAM_UX.md) — End-to-end student exam lifecycle UX, thumb zone ergonomics, and zero-data-loss architecture
- [`docs/RESPONSIVE_TEST_RESULTS.md`](docs/RESPONSIVE_TEST_RESULTS.md) — Detailed responsive verification matrix and 8-viewport test results
- [`docs/ACCESSIBILITY_AUDIT.md`](docs/ACCESSIBILITY_AUDIT.md) — Automated Axe-core WCAG 2.1 AA audit, color contrast ratios, and keyboard navigation
- [`docs/PHASE_A_VERIFICATION.md`](docs/PHASE_A_VERIFICATION.md) — Phase A executive release verification and quality gate report

### Core Architecture & Technical Documentation
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Modular monolith design & blueprint deviations
- [`docs/DATABASE.md`](docs/DATABASE.md) — Phase 1–3 schemas, RLS model, immutability triggers, and RPCs
- [`docs/QUESTION_BANK.md`](docs/QUESTION_BANK.md) — Question types, immutable versioning, Safe KaTeX, and CSV/XLSX bulk import
- [`docs/EXAM_MANAGEMENT.md`](docs/EXAM_MANAGEMENT.md) — Exam builder, scheduling, conflict detection, previews, and admin oversight
- [`docs/EXAM_LIFECYCLE.md`](docs/EXAM_LIFECYCLE.md) — State machine, readiness validation, atomic publishing, and Phase 3 handoff
- [`docs/STUDENT_EXAM_ENGINE.md`](docs/STUDENT_EXAM_ENGINE.md) — Student eligibility, authoritative UTC timing, deterministic realization & isolation
- [`docs/ANSWER_PERSISTENCE.md`](docs/ANSWER_PERSISTENCE.md) — Offline IndexedDB recovery queue, explicit UI states & monotonic idempotent saves
- [`docs/EXAM_ATTEMPT_LIFECYCLE.md`](docs/EXAM_ATTEMPT_LIFECYCLE.md) — Attempt lifecycle vs grading/release states, review flow & immutable receipts
- [`docs/GRADING_ENGINE.md`](docs/GRADING_ENGINE.md) — Auto-scoring, manual essay grading, audited adjustments & result release policies
- [`docs/EXAM_FAILURE_RECOVERY.md`](docs/EXAM_FAILURE_RECOVERY.md) — Failure mode matrix & 100-student exam load harness (`scripts/load-test-exam-engine.ts`)
- [`docs/PHASE3_VERIFICATION.md`](docs/PHASE3_VERIFICATION.md) — Phase 3 honest verification report
- [`docs/EXAM_SECURITY_ENGINE.md`](docs/EXAM_SECURITY_ENGINE.md) — Phase 4 configurable security policies, publish snapshots, prompt-only guards & overrides
- [`docs/REALTIME_MONITORING.md`](docs/REALTIME_MONITORING.md) — Teacher/Admin control centers, ~30s heartbeats, batched `sendBeacon()` telemetry & Supabase Realtime + fallback
- [`docs/EXAMBRO_INTEGRATION.md`](docs/EXAMBRO_INTEGRATION.md) — Android ExamBro (`com.dekikurnia.exambro`) QR code SVG & honest `unverified_client_hint` classification
- [`docs/SEB_INTEGRATION.md`](docs/SEB_INTEGRATION.md) — Official Safe Exam Browser ConfigKey/RequestHash SHA-256 verification, `.seb` config & `sebs://` deep links
- [`docs/SECURITY_INCIDENT_WORKFLOW.md`](docs/SECURITY_INCIDENT_WORKFLOW.md) — Non-accusatory deduplicated incidents, manual review transitions & CSV exports
- [`docs/EXAM_MONITORING_PRIVACY.md`](docs/EXAM_MONITORING_PRIVACY.md) — Data minimization, 2KB telemetry bounds, privacy disclosure & Admin retention cleanup
- [`docs/PHASE4_VERIFICATION.md`](docs/PHASE4_VERIFICATION.md) — Phase 4 honest verification report (historical Phase 4 offline baseline)
- [`docs/PHASE5_INTEGRATION_REPORT.md`](docs/PHASE5_INTEGRATION_REPORT.md) — Phase 5 executive verification report (live local Supabase, E2E, load & recovery)
- [`docs/LOCAL_SUPABASE_SETUP.md`](docs/LOCAL_SUPABASE_SETUP.md) — Reproducible local Docker Supabase CLI setup, reset & test workflow
- [`docs/END_TO_END_EXAM_VERIFICATION.md`](docs/END_TO_END_EXAM_VERIFICATION.md) — Authenticated Playwright E2E + WCAG verification across student/teacher flows
- [`docs/DATABASE_SECURITY_AUDIT.md`](docs/DATABASE_SECURITY_AUDIT.md) — Live PostgreSQL RLS, RBAC boundary audit & Phase 5 fixes (`000010`)
- [`docs/CONCURRENCY_TEST_RESULTS.md`](docs/CONCURRENCY_TEST_RESULTS.md) — 100-concurrent-student exam & monitoring HTTP + PostgreSQL load benchmarks
- [`docs/BACKUP_RECOVERY_TEST.md`](docs/BACKUP_RECOVERY_TEST.md) — Verified `pg_dump` / `pg_restore` schema, RLS, function & checksum parity drill
- [`docs/PRODUCTION_READINESS_GAPS.md`](docs/PRODUCTION_READINESS_GAPS.md) — Honest remaining infrastructure, browser hardware, and scale gaps
- [`docs/SECURITY.md`](docs/SECURITY.md) — Authorization, secret/answer-key boundaries, XSS/formula safety, and OWASP alignment
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase & Vercel setup, environment rules, plan limits
- [`docs/TESTING.md`](docs/TESTING.md) — Unit, API/service-boundary, live RLS, and Playwright E2E/WCAG testing
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Phased delivery roadmap aligned with the Technical Blueprint
- [`docs/EXAM_BROWSER_INTEGRATION.md`](docs/EXAM_BROWSER_INTEGRATION.md) — ExamBro & SEB iOS technical research
