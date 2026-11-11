# UjianKita

**UjianKita** is a web-first Computer-Based Testing (CBT) platform designed for official school examinations on students' personal Android phones (via **ExamBro**) and iPhones (via **Safe Exam Browser / SEB**), paired with web workspaces for school administrators and teachers.

> **Current Stage — Phase 2 (Question Bank & Examination Management):**
> This repository extends the Phase 1 foundation with the complete Phase 2 examination preparation workflow (**Question Bank → Examination Builder → Configuration → Preview → Review → Publish → Schedule**), immutable question & exam versioning, separated answer keys, CSV/XLSX bulk import, Safe KaTeX rendering, and SQL migrations `000003`–`000005`. **Note:** Live cloud Supabase/Vercel provisioning and PostgreSQL runtime execution remain pending user cloud configuration; student exam-taking attempts, grading, and ExamBro/SEB monitoring belong to Phase 3–4. **UjianKita must not be represented as ready for official high-stakes examinations until live DB verification and Phases 3–4 are completed.**

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
- [`docs/DATABASE.md`](docs/DATABASE.md) — Phase 1 & Phase 2 schemas, RLS model, immutability triggers, and RPCs
- [`docs/QUESTION_BANK.md`](docs/QUESTION_BANK.md) — Question types, immutable versioning, Safe KaTeX, and CSV/XLSX bulk import
- [`docs/EXAM_MANAGEMENT.md`](docs/EXAM_MANAGEMENT.md) — Exam builder, scheduling, conflict detection, previews, and admin oversight
- [`docs/EXAM_LIFECYCLE.md`](docs/EXAM_LIFECYCLE.md) — State machine, readiness validation, atomic publishing, and Phase 3 handoff
- [`docs/SECURITY.md`](docs/SECURITY.md) — Authorization, secret/answer-key boundaries, XSS/formula safety, and OWASP alignment
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Supabase & Vercel setup, environment rules, plan limits
- [`docs/TESTING.md`](docs/TESTING.md) — Unit, API/service-boundary, live RLS, and Playwright E2E/WCAG testing
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — Phased delivery roadmap aligned with the Technical Blueprint
- [`docs/EXAM_BROWSER_INTEGRATION.md`](docs/EXAM_BROWSER_INTEGRATION.md) — ExamBro & SEB iOS technical research
