# UjianKita Phase 5 — Local Database Integration & Hardening Report

Phase 5 verified and hardened Phases 1–4 against a **live local Docker Supabase PostgreSQL + Auth + PostgREST stack** running migrations `20261112000001` through `20261112000010` (`postgres:15.19.0.018` on `127.0.0.1:54321` / `127.0.0.1:54322`).

No cloud Supabase projects were created and no Vercel production deployment was executed; cloud infrastructure provisioning remains under the project owner's control.

---

## 1. Defects Identified & Fixed During Phase 5 Verification

| Defect ID | Root Cause Discovered Under Live Execution | Fix Implemented | Verification |
|---|---|---|---|
| **BUG-01** (`options_snapshot` key mismatch) | `publish_exam_atomic` froze `exam_version_questions.options_snapshot` with snake_case keys (`option_key`, `option_text`, `display_order`), whereas `start_or_resume_exam_attempt` read camelCase keys when shuffling/mapping options. | Updated `start_or_resume_exam_attempt` in `supabase/migrations/20261112000010_phase5_security_and_rpc_hardening.sql` to support snake_case keys with camelCase fallback. | Live DB integration tests + Playwright E2E + 100-student randomized load test |
| **BUG-02** (`auth_student_id() IS NULL` guard) | `record_attempt_heartbeat_atomic` and `record_monitoring_events_batch_atomic` could pass ownership equality checks if `auth_student_id()` returned `NULL`. | Enforced explicit non-null `auth_student_id()` and strict ownership checks inside `20261112000010_phase5_security_and_rpc_hardening.sql`. | Live RLS & RBAC test cases in `tests/integration/phase5-rls-and-cross-school.test.ts` |
| **BUG-03** (Monitoring role separation) | `auditor` read-only role and `proctor` write/review capabilities required distinct RLS/RPC enforcement across monitoring, incidents, overrides, and student/exam visibility. | Added `auth_can_write_exam_monitoring(uuid)` alongside `auth_can_monitor_exam(uuid)`, separated read-only `auditor` from write RPCs, and tightened scoped RLS policies in `000010`. | Live integration assertions in `tests/integration/phase5-rls-and-cross-school.test.ts` |
| **SSR Hydration #418** (`ExamPlayerClient` Node 22 `navigator.onLine`) | Node.js 22 defines global `navigator` with `navigator.onLine === undefined`. `ExamPlayerClient` initialized `isOnline` with `typeof navigator === "undefined" ? true : navigator.onLine`, rendering offline `<WifiOff />` badges in SSR HTML while Chromium hydrated online `<Wifi />`. | Changed initial `isOnline` state in `src/components/features/student/exam-player-client.tsx` to deterministic `true` and synchronized `navigator.onLine` post-mount inside `useEffect`. | Production `next start` + Playwright E2E on `desktop-chromium` and `mobile-android` (`0` pageerrors, `0` console errors) |
| **Windows Worker Memory & Env Limits** | Vitest default worker count and Next 16 build worker fan-out triggered V8 worker OOM under Windows, and passing 100 SSR JWT cookies via env vars hit Windows `CreateProcess` 32 KB limits. | Set `maxWorkers: 2` (`vitest.config.mts`), bounded `experimental.cpus` / `memoryBasedWorkersCount: true` (`next.config.ts`), and added `LOAD_TEST_TOKENS_FILE` / `LOAD_TEST_SESSIONS_FILE` support to `scripts/load-test-exam-engine.ts` and `scripts/load-test-monitoring.ts`. | Full Vitest, production build, and 100-student local HTTP + DB load drills passed |

---

## 2. Verification Matrix Summary

| Suite / Drill | Scope | Observed Result | Notes & Conditions |
|---|---|---|---|
| Migrations & Seed (`supabase db reset`) | `20261112000001`–`20261112000010` + `supabase/seed.sql` | **Exited `0`** cleanly against local Docker Postgres (`127.0.0.1:54322`) | Repeated cleanly after cleanups |
| ESLint & TypeScript (`npm run lint`, `npm run typecheck`) | Full repository (`src/`, `tests/`, `scripts/`) | **Exited `0`** (`0` errors, `0` warnings) | Static lint and strict TS checks |
| Production Build (`npm run build`) | Next.js 16.4.6 (Turbopack) | **Exited `0`** (`30/30` static routes + dynamic/API routes) | Built with `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100` |
| Vitest Unit & Live-DB Integration (`RUN_LIVE_DB_TESTS=true npm run test`) | 21 test files across unit, route boundaries, mocked services, and live PostgreSQL RLS/RPC suites | **21 files passed, 92 tests passed, 0 failed, 0 skipped** | Runs all live `describe.skipIf(!hasLiveSupabase)` suites against local Supabase |
| Playwright E2E + WCAG 2.2 AA (`desktop-chromium`, `mobile-android`) | `foundation.spec.ts`, `phase3-exam-flow.spec.ts`, `phase4-monitoring.spec.ts`, `phase5-authenticated-workflows.spec.ts` | **24 passed, 0 failed** (`0` page errors, `0` console errors, `0` Axe violations) | `mobile-iphone` (WebKit) excluded locally on Windows (`exitCode=3221225501` missing host DLLs); covered in Ubuntu CI |
| Exam Engine 100-Student Load (`scripts/load-test-exam-engine.ts`) | 100 virtual students: `/start` -> workspace -> 10 `/answers` + Q1 idempotent retry -> concurrent double `/submit` | **100/100 succeeded cleanly**, `0` HTTP errors; DB parity `100` attempts / `1000` answers / `100` receipts / `100` grades | Authenticated via `@supabase/ssr` cookies directly against local Auth (`POST /api/auth/login` has a 15/5min IP limit — see `PRODUCTION_READINESS_GAPS.md`) |
| Monitoring 100-Student Load (`scripts/load-test-monitoring.ts`) | 100 concurrent active students: `/heartbeat` -> batched `/events` -> `/answers` | **100/100 succeeded (`okCount: 100`, `failedCount: 0`)** in `4453.2 ms`; DB verified `100` presence rows, `300` events, `100` answers | Local loopback Docker stack |
| PostgreSQL Backup & Restore (`pg_dump` / `pg_restore`) | Dump `public` + `auth` schemas (`631,978` bytes) and restore into isolated `ujiankita_restore_verify` | **Exited `0`** (`3,251 ms`); exact parity (`48` tables, `100` RLS policies, `52` functions, `158` FKs) & identical table MD5 digests | Isolated local drill; staging/cloud PITR still required |

---

## 3. Detailed Phase 5 Reports

- [`LOCAL_SUPABASE_SETUP.md`](LOCAL_SUPABASE_SETUP.md) — Local Docker Supabase setup, reset, and environment configuration
- [`END_TO_END_EXAM_VERIFICATION.md`](END_TO_END_EXAM_VERIFICATION.md) — Authenticated Playwright UI & WCAG walkthrough
- [`DATABASE_SECURITY_AUDIT.md`](DATABASE_SECURITY_AUDIT.md) — Live PostgreSQL RLS, RBAC boundary audit & `000010` fixes
- [`CONCURRENCY_TEST_RESULTS.md`](CONCURRENCY_TEST_RESULTS.md) — 100-student HTTP & PostgreSQL load drill benchmarks
- [`BACKUP_RECOVERY_TEST.md`](BACKUP_RECOVERY_TEST.md) — Real `pg_dump` / `pg_restore` disaster recovery verification
- [`PRODUCTION_READINESS_GAPS.md`](PRODUCTION_READINESS_GAPS.md) — Remaining operational, scaling, and physical browser hardware gaps
