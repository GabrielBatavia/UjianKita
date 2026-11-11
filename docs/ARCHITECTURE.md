# System Architecture

UjianKita is structured as a **modular monolith** built on Next.js App Router, preserving strict boundaries between UI presentation, HTTP/route transport, business services, authorization policies, database repositories, and domain contracts.

---

## 1. Architectural Principles

1. **No client trust:** Roles, school boundaries, and future examination timers/deadlines/scores are verified authoritatively on the server and enforced by PostgreSQL Row Level Security (RLS).
2. **Strict layer separation:** React components and route handlers do not embed business logic or direct database policy shortcuts.
3. **Portable foundation:** All business rules, schemas, and SQL migrations use standard Next.js APIs and PostgreSQL/Supabase primitives without proprietary lock-in to hosting-specific queues or microservices.
4. **Honest Phase 2 boundaries:** Phase 1–2 deliver authentication, school academic administration, immutable audit logging, the complete Question Bank, and the Examination Management & Publishing workflow producing frozen `exam_versions` snapshots. Student examination attempt delivery, answer saving, grading, and live proctoring remain explicitly scoped for Phase 3–4 without fabricating attempt or grade records.

---

## 2. Directory & Module Map

```text
src/
├── proxy.ts                   # Next.js 16 network boundary: session refresh & route auth guard
├── app/
│   ├── (auth)/                # Public auth views (/login, /forgot-password, /reset-password, /auth/callback)
│   ├── (portal)/              # Authenticated role-scoped workspaces (/admin, /teacher, /student, /dashboard)
│   │   ├── admin/exams/       # Admin exam oversight list, detail, snapshot history, and preview
│   │   ├── teacher/questions/ # Teacher Question Bank, create/edit revisions, CSV/XLSX import
│   │   └── teacher/exams/     # Exam builder, configuration, scheduling, publish, and preview
│   └── api/                   # Thin REST handlers (/api/health, /api/auth/*, /api/admin/*, /api/teacher/*)
├── components/
│   ├── ui/                    # Reusable shadcn/Radix accessible primitives
│   ├── layout/                # PortalShell, navigation menus, EmptyState, UpcomingModuleCard, AccessDenied
│   └── features/              # Feature client forms, QuestionEditor, QuestionImportWizard, ExamWorkspace, ExamPreviewClient
├── domain/                    # Pure domain models, Phase 2 validation/lifecycle, & Phase 3 reliability contracts
│   ├── auth/                  # Actor, role, permission types
│   ├── academic/              # School, academic year, class, subject, teacher, student types
│   ├── audit/                 # Audit action enums & payload shapes
│   ├── exams/                 # Phase 2 Question rules, CSV/XLSX parser, lifecycle & Phase 3 attempt/SEB contracts
│   └── system/                # Health telemetry types
├── policies/                  # Pure RBAC + tenant + record ownership authorization functions
├── schemas/                   # Zod input & environment validation schemas (`exams.ts`, `academic.ts`, `auth.ts`)
├── repositories/              # Typed Supabase data access queries (`question-bank-repository.ts`, `exam-repository.ts`, etc.)
├── services/                  # Business logic orchestration (`question-bank-service.ts`, `exam-service.ts`, `admin-service.ts`, `auth-service.ts`)
└── lib/                       # Env validation, sliding-window rate limiter, `question-content.ts` (Safe KaTeX), security helpers, Supabase clients
```

---

## 3. Deviations from the Technical Blueprint PDF

The Technical Blueprint (v1.0) proposed a reference stack and long-term role set for the full platform. Phase 1 follows the project's explicit architectural directives and records the following deliberate deviations:

| Area | Technical Blueprint PDF | Phase 1 Implementation | Rationale |
|---|---|---|---|
| **Backend Runtime** | Separate NestJS API server | Modular monolith in Next.js App Router (`src/services/`, `src/app/api/`) | Reduces operational surface in Phase 1 while keeping clean service/domain modules portable to a standalone backend if needed later. |
| **ORM / Migrations** | Prisma | Official Supabase SDK (`@supabase/supabase-js`, `@supabase/ssr`) + versioned SQL migrations (`supabase/migrations/`) | Leverages native PostgreSQL RLS policies, triggers, and partial indexes directly without ORM/RLS mismatch. |
| **Cache / Ephemeral State** | Redis | Sliding-window in-memory limiter (`src/lib/rate-limit.ts`) for Phase 1; Redis/centralized store deferred | Blueprint itself states Redis is never the source of confirmed answers; keeping Phase 1 infrastructure minimal avoids premature complexity. |
| **User Roles** | 6 roles (`School administrator`, `Exam coordinator`, `Teacher`, `Proctor`, `Student`, `Auditor`) | Phase 1 UI/auth activates `admin`, `teacher`, and `student`; DB `roles` table already seeds `exam_coordinator`, `proctor`, and `auditor` | Supports Phase 1 workflows cleanly while ensuring zero schema breaking changes when Phase 2/3 roles go live. |
| **Live Monitoring** | WebSockets + fallback | Deferred to Phase 3; documented via `ObservedMonitoringEventType` contract | Prevents premature implementation before core answer persistence is built. |

---

## 4. Future Examination Reliability Design (Prepared in `src/domain/exams/contracts.ts`)

To support ~100 simultaneous students in Phase 2 without silent data loss:

- **Server-authoritative clock:** Attempt `started_at` and `deadline_at` are created and stored in UTC on PostgreSQL; client timers are presentation-only.
- **Confirmed vs. pending states:** An answer transitions to "Saved" only upon a PostgreSQL commit acknowledgment (`COMMITTED` or `IDEMPOTENT_REPLAY`). Local buffering (`IndexedDB`/storage) is strictly an unconfirmed pending queue.
- **Monotonic revision & idempotency:** `evaluateRevisionWrite()` rejects stale out-of-order revisions (`incomingRevision <= currentRevision`) and treats duplicate `idempotencyKey` retries safely without duplicating writes.
- **Immutable exam versions & atomic receipts:** Once candidates begin an approved exam version, questions, keys, and scoring policies freeze. Finalization executes inside a database transaction that freezes the answer snapshot and emits an atomic `SubmissionReceipt`.
