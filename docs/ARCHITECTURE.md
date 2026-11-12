# System Architecture

UjianKita is structured as a **modular monolith** built on Next.js App Router, preserving strict boundaries between UI presentation, HTTP/route transport, business services, authorization policies, database repositories, and domain contracts.

---

## 1. Architectural Principles

1. **No client trust:** Roles, school boundaries, and future examination timers/deadlines/scores are verified authoritatively on the server and enforced by PostgreSQL Row Level Security (RLS).
2. **Strict layer separation:** React components and route handlers do not embed business logic or direct database policy shortcuts.
3. **Portable foundation:** All business rules, schemas, and SQL migrations use standard Next.js APIs and PostgreSQL/Supabase primitives without proprietary lock-in to hosting-specific queues or microservices.
4. **Honest Phase 4 boundaries:** Phases 1–4 deliver authentication, school academic administration, immutable audit logging, the Question Bank & Exam Publishing workflow (`exam_versions`), authoritative student exam attempts (`exam_attempts`), monotonic idempotent answer persistence, atomic receipts, automated + manual grading, result release policies, and Phase 4 examination security & monitoring (`exam_security_policies`, publish-time `exam_security_policy_versions`, presence heartbeats, bounded telemetry, deduplicated incidents, ExamBro QR compatibility, SEB ConfigKey/RequestHash verification, emergency proctor overrides, prompt-only guards, and retention cleanup). Live PostgreSQL execution of migrations `000001`–`000009`, live Supabase Realtime delivery, physical ExamBro/SEB device testing, and 100-student live database load benchmarks remain pending prior to high-stakes launch.

---

## 2. Directory & Module Map

```text
src/
├── proxy.ts                   # Next.js 16 network boundary: session refresh & route auth guard
├── app/
│   ├── (auth)/                # Public auth views (/login, /forgot-password, /reset-password, /auth/callback)
│   ├── (portal)/              # Authenticated role-scoped workspaces (/admin, /teacher, /student, /dashboard)
│   │   ├── admin/exams/       # Admin exam oversight list, detail, snapshot history, preview & attempt cancellation
│   │   ├── admin/monitoring/  # Admin school-wide monitoring oversight & retention purge (`/admin/monitoring`, `[examId]`)
│   │   ├── teacher/questions/ # Teacher Question Bank, create/edit revisions, CSV/XLSX import
│   │   ├── teacher/exams/     # Exam builder, configuration, scheduling, publish, preview & /grading room
│   │   ├── teacher/monitoring/# Teacher & proctor real-time Control Center (`[examId]`, `students/[attemptId]`, `incidents`)
│   │   ├── teacher/grading/   # Cross-exam grading & result publication workspace
│   │   └── student/           # Student exam catalog (/exams), security cards, instructions, exam player & review (/attempts/*), /results
│   └── api/                   # Thin REST handlers (/api/health, /api/auth/*, /api/admin/*, /api/teacher/*, /api/student/*)
├── components/
│   ├── ui/                    # Reusable shadcn/Radix accessible primitives
│   ├── layout/                # PortalShell (distraction-free mode on active attempt routes), EmptyState, AccessDenied
│   └── features/              # Auth, Admin, Question Bank, Exam Builder, Monitoring Control Center, ExamPlayerClient, Review, Receipt, Results & TeacherGradingWorkspace
├── domain/                    # Pure domain models, Phase 2 validation/lifecycle, Phase 3 engine logic & Phase 4 monitoring/browser integration
│   ├── auth/                  # Actor, role, permission types
│   ├── academic/              # School, academic year, class, subject, teacher, student types
│   ├── audit/                 # Audit action enums & payload shapes
│   ├── exams/                 # Question rules, CSV/XLSX parser, Phase 2 lifecycle, Phase 3 contracts/eligibility/grading
│   ├── monitoring/            # Phase 4 presence/incidents, CSV reports, ExamBro QR SVG (`exambro-compat.ts`), SEB ConfigKey & RequestHash (`seb-verification.ts`)
│   └── system/                # Health telemetry types
├── policies/                  # Pure RBAC + tenant + record ownership authorization functions
├── schemas/                   # Zod validation schemas (`exams.ts`, `attempts.ts`, `monitoring.ts`, `academic.ts`, `auth.ts`)
├── repositories/              # Typed Supabase queries & RPC wrappers (`attempt-repository.ts`, `grading-repository.ts`, `monitoring-repository.ts`, etc.)
├── services/                  # Business logic orchestration (`attempt-service.ts`, `grading-service.ts`, `monitoring-service.ts`, `exam-service.ts`, etc.)
└── lib/                       # Env validation, IP/actor rate limiter, `exam-storage.ts`, `question-content.ts`, `supabase/policy-reader.ts`, `api-helpers.ts`
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
| **Live Monitoring** | WebSockets + fallback | Supabase Realtime (`attempt_monitoring_presence` & `exam_security_incidents`) + 15s polling fallback (Phase 4) | Delivers live ~100-student proctoring visibility without coupling exam submissions to stateful WebSocket availability. |

---

## 4. Examination Reliability Design (Implemented in Phase 3)

Built across `src/domain/exams/contracts.ts`, `src/lib/exam-storage.ts`, `src/services/attempt-service.ts`, and migration `20261112000007_phase3_rls_and_attempt_rpcs.sql` to support ~100 simultaneous students:

- **Server-authoritative clock:** Attempt `started_at_utc` and `deadline_at_utc` are computed and enforced inside PostgreSQL; `ExamPlayerClient` synchronizes offset every 45s via `GET /api/student/attempts/[attemptId]/time`.
- **Confirmed vs. pending states:** Answer indicators display `"Tersimpan"` strictly after receiving a PostgreSQL commit acknowledgment (`COMMITTED` or `IDEMPOTENT_REPLAY`). Client-side buffering via `IndexedDB` (`ujiankita_exam_queue_v1`, with `memory_only` private-browsing fallback warning) stays visibly labeled as pending/offline (`Menunggu koneksi` / `Sinkronisasi diperlukan`).
- **Monotonic revision & idempotency:** `save_attempt_answer_atomic` (and pure `evaluateRevisionWrite()` contract) reject stale out-of-order writes (`STALE_REVISION_REJECTED`, HTTP 409) and replay matching `(attempt_id, idempotency_key)` + `request_hash` pairs cleanly (`IDEMPOTENT_REPLAY`, HTTP 200) while catching payload hash mismatches (`IDEMPOTENCY_CONFLICT`, HTTP 409).
- **Immutable snapshots & atomic receipts:** `attempt_question_assignments` isolates student-safe prompt snapshots from canonical `exam_version_answer_keys`, and `_finalize_attempt_internal` locks attempts `FOR UPDATE`, creates immutable `exam_submissions` + `submission_receipts`, and computes initial objective grades inside one transaction.

---

## 5. Examination Security, Browser Modes & Real-Time Monitoring (Implemented in Phase 4)

Built across `src/domain/monitoring/`, `src/services/monitoring-service.ts`, `src/repositories/monitoring-repository.ts`, `src/lib/supabase/policy-reader.ts`, and migrations `000008`–`000009`:

- **Configurable, snapshot-locked security policies:** Teachers configure per-exam browser policies (`STANDARD_BROWSER_ALLOWED`, `SECURE_BROWSER_RECOMMENDED`, `VERIFIED_SEB_REQUIRED`), thresholds, watermark settings, and privacy notice (`exam_security_policies`). Publishing an exam triggers `trg_snapshot_security_policy_on_publish` to freeze an immutable `exam_security_policy_versions` row alongside `exam_versions`.
- **Honest browser trust boundaries:** Android ExamBro (`com.dekikurnia.exambro`) QR launches and client hints are surfaced transparently as `unverified_client_hint` (`src/domain/monitoring/exambro-compat.ts`). Strong cryptographic enforcement (`VERIFIED_SEB_REQUIRED`) relies strictly on official Safe Exam Browser ConfigKey/RequestHash SHA-256 verification (`src/domain/monitoring/seb-verification.ts`) plus audited emergency staff overrides (`exam_student_browser_overrides`).
- **Non-intrusive, fail-safe monitoring:** Student heartbeats (~30s jittered) update a compact single row (`attempt_monitoring_presence`), batched client visibility/reload/copy events flush via `sendBeacon()` / `fetch` (`<=25` events, `<=2KB` metadata, `clientEventId` dedupe), and monitoring RPC failures never block exam answer saves or final submission. Deduplicated security incidents require human review (`NEW -> UNDER_REVIEW -> ACKNOWLEDGED -> RESOLVED | DISMISSED`) and never mutate student scores.
