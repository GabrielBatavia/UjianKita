# UjianKita

**UjianKita** is a web-first Computer-Based Testing (CBT) platform designed for official school examinations on students' personal Android phones (via **ExamBro**) and iPhones (via **Safe Exam Browser / SEB**), paired with web workspaces for school administrators and teachers.

> **Current Stage — Phase 6.5 (Controlled Production Cutover, Cloud Integration & Final Verification):**
> Phases 1–6.5 deliver the complete Next.js 16 + Supabase PostgreSQL CBT application across migrations `000001`–`000011`, running live on **Vercel Production** (`https://ujiankita-three.vercel.app`) co-located in Mumbai (`bom1`) with **Supabase PostgreSQL 17** (`hqoxqmmkysnnneqlepuj`). Features include Question Bank, Examination Builder & immutable `exam_versions`, authoritative student attempt/autosave/submission/receipt engine, automated + manual grading with audited adjustments, Phase 4 examination security & real-time proctoring control centers, distributed PostgreSQL login rate-limiting (`000011`), and full end-to-end cloud staging & production verification. **Operational Classification:** The system is live in a **Controlled Evaluation / Closed School Pilot Preparation** state. High-stakes official school rollout remains gated on physical Android ExamBro / iOS Safe Exam Browser device pilots, commercial tier upgrades (Supabase Pro with PITR backups), and staff TOTP MFA; see [`docs/PRODUCTION_READINESS_GAPS.md`](docs/PRODUCTION_READINESS_GAPS.md) and [`docs/PILOT_READINESS_CHECKLIST.md`](docs/PILOT_READINESS_CHECKLIST.md).

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
