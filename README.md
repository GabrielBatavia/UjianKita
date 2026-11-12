# UjianKita

**UjianKita** is a web-first Computer-Based Testing (CBT) platform designed for official school examinations on students' personal Android phones (via **ExamBro**) and iPhones (via **Safe Exam Browser / SEB**), paired with web workspaces for school administrators and teachers.

> **Current Stage — Phase 3 (Student Examination Engine & Grading):**
> This repository extends Phases 1–2 with the Phase 3 student examination lifecycle (`exam_attempts`, deterministic question/option realization, monotonic idempotent autosave with offline IndexedDB buffering, atomic `submission_receipts`, server-side objective auto-scoring, manual essay rubric grading, audited score adjustments, configurable result release policies, and SQL migrations `000006`–`000007`). **Note:** Live cloud Supabase/Vercel provisioning, live PostgreSQL RLS/RPC execution, real-device ExamBro/SEB verification, and isolated 100-student load benchmark runs remain pending; **UjianKita must not be represented as ready for official high-stakes examinations until live DB verification, concurrency load testing, and ExamBro/SEB device verification are completed.**

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
- [`docs/EXAM_FAILURE_RECOVERY.md`](docs/EXAM_FAILURE_RECOVERY.md) — Failure mode matrix & 100-student load testing harness (`scripts/load-test-exam-engine.ts`)
- [`docs/PHASE3_VERIFICATION.md`](docs/PHASE3_VERIFICATION.md) — Phase 3 honest verification report (verified offline vs pending live DB/load)
- [`docs/SECURITY.md`](docs/SECURITY.md) — Authorization, secret/answer-key boundaries, XSS/formula safety, and OWASP alignment
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase & Vercel setup, environment rules, plan limits
- [`docs/TESTING.md`](docs/TESTING.md) — Unit, API/service-boundary, live RLS, and Playwright E2E/WCAG testing
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Phased delivery roadmap aligned with the Technical Blueprint
- [`docs/EXAM_BROWSER_INTEGRATION.md`](docs/EXAM_BROWSER_INTEGRATION.md) — ExamBro & SEB iOS technical research
