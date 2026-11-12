# System Architecture

UjianKita is structured as a **modular monolith** built on Next.js App Router, preserving strict boundaries between UI presentation, HTTP/route transport, business services, authorization policies, database repositories, and domain contracts.

---

## 1. Architectural Principles

1. **No client trust:** Roles, school boundaries, and future examination timers/deadlines/scores are verified authoritatively on the server and enforced by PostgreSQL Row Level Security (RLS).
2. **Strict layer separation:** React components and route handlers do not embed business logic or direct database policy shortcuts.
3. **Portable foundation:** All business rules, schemas, and SQL migrations use standard Next.js APIs and PostgreSQL/Supabase primitives without proprietary lock-in to hosting-specific queues or microservices.
4. **Honest Phase 3 boundaries:** Phases 1–3 deliver authentication, school academic administration, immutable audit logging, the complete Question Bank, the Examination Management & Publishing workflow (`exam_versions`), authoritative student exam attempts (`exam_attempts`), monotonic idempotent answer persistence (`IndexedDB` recovery queue + PostgreSQL RPCs), atomic submission receipts, automated objective + manual essay grading, audited adjustments, and configurable result release policies. Real-device ExamBro/SEB ConfigKey validation, live PostgreSQL RLS/RPC execution, live proctoring coordinator dashboards, and 100-student load benchmark runs remain pending prior to high-stakes production launch.

---

## 2. Directory & Module Map

```text
src/
├── proxy.ts                   # Next.js 16 network boundary: session refresh & route auth guard
├── app/
│   ├── (auth)/                # Public auth views (/login, /forgot-password, /reset-password, /auth/callback)
│   ├── (portal)/              # Authenticated role-scoped workspaces (/admin, /teacher, /student, /dashboard)
│   │   ├── admin/exams/       # Admin exam oversight list, detail, snapshot history, preview & attempt cancellation
│   │   ├── teacher/questions/ # Teacher Question Bank, create/edit revisions, CSV/XLSX import
│   │   ├── teacher/exams/     # Exam builder, configuration, scheduling, publish, preview & /grading room
│   │   ├── teacher/grading/   # Cross-exam grading & result publication workspace
│   │   └── student/           # Student exam catalog (/exams), instructions, exam player & review (/attempts/*), /results
│   └── api/                   # Thin REST handlers (/api/health, /api/auth/*, /api/admin/*, /api/teacher/*, /api/student/*)
├── components/
│   ├── ui/                    # Reusable shadcn/Radix accessible primitives
│   ├── layout/                # PortalShell (distraction-free mode on active attempt routes), EmptyState, AccessDenied
│   └── features/              # Auth, Admin, Question Bank, Exam Builder, ExamPlayerClient, Review, Receipt, Results & TeacherGradingWorkspace
├── domain/                    # Pure domain models, Phase 2 validation/lifecycle, & Phase 3 engine logic
│   ├── auth/                  # Actor, role, permission types
│   ├── academic/              # School, academic year, class, subject, teacher, student types
│   ├── audit/                 # Audit action enums & payload shapes
│   ├── exams/                 # Question rules, CSV/XLSX parser, Phase 2 lifecycle, Phase 3 contracts/eligibility/grading
│   └── system/                # Health telemetry types
├── policies/                  # Pure RBAC + tenant + record ownership authorization functions
├── schemas/                   # Zod validation schemas (`exams.ts`, `attempts.ts`, `academic.ts`, `auth.ts`)
├── repositories/              # Typed Supabase queries & RPC wrappers (`attempt-repository.ts`, `grading-repository.ts`, etc.)
├── services/                  # Business logic orchestration (`attempt-service.ts`, `grading-service.ts`, `exam-service.ts`, etc.)
└── lib/                       # Env validation, IP/actor sliding-window rate limiter, `exam-storage.ts` (IndexedDB queue), `question-content.ts` (Safe KaTeX), `api-helpers.ts`
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

## 4. Examination Reliability Design (Implemented in Phase 3)

Built across `src/domain/exams/contracts.ts`, `src/lib/exam-storage.ts`, `src/services/attempt-service.ts`, and migration `20261112000007_phase3_rls_and_attempt_rpcs.sql` to support ~100 simultaneous students:

- **Server-authoritative clock:** Attempt `started_at_utc` and `deadline_at_utc` are computed and enforced inside PostgreSQL; `ExamPlayerClient` synchronizes offset every 45s via `GET /api/student/attempts/[attemptId]/time`.
- **Confirmed vs. pending states:** Answer indicators display `"Tersimpan"` strictly after receiving a PostgreSQL commit acknowledgment (`COMMITTED` or `IDEMPOTENT_REPLAY`). Client-side buffering via `IndexedDB` (`ujiankita_exam_queue_v1`, with `memory_only` private-browsing fallback warning) stays visibly labeled as pending/offline (`Menunggu koneksi` / `Sinkronisasi diperlukan`).
- **Monotonic revision & idempotency:** `save_attempt_answer_atomic` (and pure `evaluateRevisionWrite()` contract) reject stale out-of-order writes (`STALE_REVISION_REJECTED`, HTTP 409) and replay matching `(attempt_id, idempotency_key)` + `request_hash` pairs cleanly (`IDEMPOTENT_REPLAY`, HTTP 200) while catching payload hash mismatches (`IDEMPOTENCY_CONFLICT`, HTTP 409).
- **Immutable snapshots & atomic receipts:** `attempt_question_assignments` isolates student-safe prompt snapshots from canonical `exam_version_answer_keys`, and `_finalize_attempt_internal` locks attempts `FOR UPDATE`, creates immutable `exam_submissions` + `submission_receipts`, and computes initial objective grades inside one transaction.
