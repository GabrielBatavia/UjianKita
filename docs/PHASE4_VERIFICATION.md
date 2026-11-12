# UjianKita Phase 4 — Verification Report & Operational Boundaries

This document separates capabilities **verified locally** in this repository from capabilities that remain **unverified live** due to postponed cloud provisioning and absent physical mobile kiosk devices.

## 1. Verified Locally (Executed Against Codebase)

| Check / Suite | Scope | Latest Observed Result & Limitations |
| :--- | :--- | :--- |
| TypeScript (`npm run typecheck`) | Strict full-repo compilation (`noUncheckedIndexedAccess: true`) | Exited `0` (static type safety only) |
| ESLint (`npm run lint`) | React 19 hooks, Next.js App Router, accessibility & TS lint rules | Exited `0` (`0` errors, `0` warnings; static lint rules only) |
| Production Build (`npm run build`) | Next.js 16.4.6 (Turbopack) production compilation & full App Router + API route manifest | Exited `0` (`30/30` static pages + dynamic/API routes; uses build-time env stubs when Supabase env absent) |
| Vitest Unit & Integration Suite (`npm run test`) | 18 test files (`tests/unit/` + `tests/integration/`, including `phase4-monitoring-domain.test.ts`, `phase4-student-watermark-and-guards.test.tsx`, and `phase4-monitoring-api.test.ts`) | **81 passed \| 5 skipped (86)** across **18 passed** files. All 5 skipped specs are `describe.skipIf(!hasLiveSupabase)` live-PostgreSQL RLS/RPC tests (`api-boundaries.test.ts`: 2, `phase2-api-and-rls.test.ts`: 1, `phase3-exam-engine.test.ts`: 1, `phase4-monitoring-api.test.ts`: 1); offline Phase 4 integration assertions run against mocked `SupabaseClient` RPC/query boundaries. |
| Playwright E2E (`npm run test:e2e`) | `foundation.spec.ts`, `phase3-exam-flow.spec.ts`, and `phase4-monitoring.spec.ts` across `desktop-chromium`, `mobile-android` (`Pixel 7`), and `mobile-iphone` (`iPhone 13` WebKit) | **33 passed** (fail-closed redirects, unauthenticated `401/403/503` checks on all Phase 4 monitoring/SEB endpoints, security headers, zero horizontal overflow, WCAG 2.2 AA). Viewport emulation is **NOT** real Android ExamBro or iOS SEB WebView testing. |
| Load Script Dry Run (`npx tsx scripts/load-test-monitoring.ts --dry-run`) | 100-student heartbeat/event/save concurrency harness serialization timing | Exited `0` (`studentCount: 100`, `okCount: 100`, `totalDurationMs: 10.15`, `maxHeartbeatMs: 9.31`). `--dry-run` does not exercise live PostgreSQL locks or connection pools. |

## 2. Unverified Live Operations (Blocked on Environment / Hardware)

1. **PostgreSQL Migrations (`000001..000009`):** Not yet executed against a live Supabase or Docker PostgreSQL engine in this environment. Live SQL syntax, triggers (`trg_snapshot_security_policy_on_publish`, `guard_attempt_events_mutation`), RLS enforcement across roles, and `SECURITY DEFINER` RPC locks remain unverified until `RUN_LIVE_DB_TESTS=true` is executed against live Supabase.
2. **Supabase Realtime Push Delivery:** Subscription code (`TeacherExamControlCenter`) and 15s polling fallback are implemented, but live WebSocket broadcast delivery requires a live Supabase Realtime tenant with replication enabled on `attempt_monitoring_presence` and `exam_security_incidents`.
3. **Physical Device Integration:**
   - **Android ExamBro (`com.dekikurnia.exambro`):** QR scan & WebView compatibility cannot be verified without an Android device running ExamBro APK.
   - **iOS/iPadOS Safe Exam Browser:** `window.SafeExamBrowser.security.updateKeys` live callback handshake & `sebs://` deep-link opening require testing on real iOS/macOS SEB hardware against HTTPS deployment.
4. **100-Student Live Database Load Test:** End-to-end throughput against connection pools must be benchmarked on staging (`LOAD_TEST_CONFIRM_ISOLATED=true`) before official school exams.
