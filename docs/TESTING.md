# Testing Strategy & Verification Matrix

UjianKita separates **offline verification** (domain unit tests, schema validation, React UI tests, route-handler auth checks, mocked service-boundary checks, and Playwright browser/WCAG tests) from **live PostgreSQL / Supabase RLS & RPC verification**, reporting both transparently.

---

## 1. Test Commands

| Command | Scope | Tools |
|---|---|---|
| `npm run lint` | ESLint 9 + Next.js / React Hooks rules | ESLint |
| `npm run typecheck` | Strict TypeScript check (`strict: true`, `noUncheckedIndexedAccess: true`) | `tsc --noEmit` |
| `npm run test` | Unit + offline integration + mocked service-boundary + live-conditional RLS suite | Vitest + Testing Library |
| `npm run build` | Production Next.js Turbopack build | `next build` |
| `npm run test:e2e` | End-to-end desktop Chromium, Pixel 7 Android, and iPhone 13 WebKit UI, fail-closed redirect, security header, and `@axe-core/playwright` WCAG 2.2 AA suites | Playwright |

---

## 2. Vitest Coverage Breakdown

### Unit Suites (`tests/unit/`)
- `authorization.test.ts` — Phase 1–3 RBAC permissions (`questions.*`, `exams.*`, `exams.grade`, `exams.results.release`, `student.exams.read`, `student.attempts.write`, `student.results.read`), school isolation, redirect sanitization.
- `schemas.test.ts` — Zod validation for auth, academic administration, and Question Bank / Exam inputs.
- `security-and-rate-limit.test.ts` — Safe error mapping and sliding-window throttling behavior.
- `exam-contracts.test.ts` — Phase 3 attempt/grading/release state machines and monotonic revision / idempotency contracts.
- `phase3-eligibility-timer.test.ts` — Classification across scheduled/open/late-join/max-attempts/active-resume states, `computeAttemptDeadlineUtcMs()`, `computeRemainingTimeMs()`, deterministic shuffle reproducibility across student attempts, and `canStudentViewExamResults()` policy gates.
- `phase3-grading.test.ts` — Scaled integer math (`toScaledPoints`/`fromScaledPoints`), single/true-false/multiple-choice scoring on canonical option keys, and guarantee that pending essays transition attempts cleanly to `PENDING_MANUAL_REVIEW` rather than zero-scoring.
- `phase3-client-persistence.test.tsx` — IndexedDB missing/private-mode graceful `memory_only` fallback warning, proof that `"Tersimpan"` is never shown prior to PostgreSQL acknowledgment, offline draft buffering + reconnect flush, and separation between question navigation (`Berikutnya`) and `/review` submission.
- `question-bank.test.ts` — Domain validation for `single_choice`, `multiple_choice`, `true_false`, and `essay`, fingerprint deduplication, and `renderSafeQuestionHtml` XSS neutralization + KaTeX rendering.
- `import-parser.test.ts` — CSV & Excel (`.xlsx`) template generation/parsing, formula cell rejection, formula prefix rejection, duplicate detection, file extension/size limits.
- `exam-lifecycle.test.ts` — Status transitions (`DRAFT -> READY_FOR_REVIEW -> PUBLISHED -> CLOSED -> ARCHIVED`, explicit `PUBLISHED -> DRAFT`), readiness checklist, cross-exam class schedule conflict detection, and deterministic shuffle seed stability with pinned items.
- `ui-components.test.tsx` & `phase2-ui.test.tsx` — Client component behavior (`LoginForm`, `getNavItemsForRole` across Phase 1–4 menus including `"Pemantauan Ujian"` and `"Pusat Keamanan"`, `QuestionEditor`, `ExamPreviewClient` desktop/mobile toggle & answer-key safety).
- `phase4-monitoring-domain.test.ts` — Official SEB-JSON canonicalization, `SHA-256(normalizedUrl + keyHex)` request hash & timing-safe `verifySebKeyProof`, XML plist extraction, honest ExamBro `unverified_client_hint` classification, ISO/IEC 18004 SVG QR generation, presence state inference, non-accusatory paired telemetry timeline & duration spans, and CSV formula injection neutralization.
- `phase4-student-watermark-and-guards.test.tsx` — Verifies `StudentExamWatermark` renders `pointer-events-none` across candidate details and verifies prompt-only `[data-exam-prompt]` copy/context guards never block essay `<textarea>` typing/copying or submission flows.

### Integration Suites (`tests/integration/`)
- `api-boundaries.test.ts` — Unauthenticated fail-closed API responses for Phase 1 routes + conditional live RLS verification (`hasLiveSupabase`).
- `phase2-api-and-rls.test.ts` — Unauthenticated fail-closed checks, mocked Phase 2 RBAC/subject/class/lock checks, safe student preview projection checks + conditional live RLS (`hasLiveSupabase`).
- `phase3-exam-engine.test.ts`:
  - **Offline Route Boundary Tests:** Verifies unauthenticated callers fail closed (`401`/`503`) on all Phase 3 student, grading, release, and admin cancel endpoints, and verifies HTTP mapping for `SaveAckOutcome` (`200` `COMMITTED`, `409` `STALE_REVISION_REJECTED`, `410` `DEADLINE_EXPIRED`, `403` `ATTEMPT_CANCELLED`) with `Cache-Control: no-store`.
  - **Offline Mocked Service-Boundary Tests:** Verifies non-student rejection, unpublished/expired eligibility fail-closed checks, order-independent canonical hash computation for `multiple_choice`, audit deduplication on submit replay, subject ownership on grading, mandatory adjustment reasons, and admin-only attempt cancellation.
  - **Live Supabase PostgreSQL RLS & RPC Suite (`describe.skipIf(!hasLiveSupabase)`):** Executed cleanly against local Docker Supabase when `RUN_LIVE_DB_TESTS=true` (`test`/`TEST_SUPABASE_*` or `.env.local`).
- `phase4-monitoring-api.test.ts`:
  - **Offline Mocked Service-Boundary Tests:** Verifies zero SEB ConfigKey/BEK hash exposure to students, `VERIFIED_SEB_REQUIRED` blocking on attempt start & workspace load even under spoofed SEB/ExamBro `User-Agent` headers, valid SHA-256 request-hash & active emergency override access, bounded telemetry metadata/batch validation, fail-safe answer saves & submissions independent of monitoring RPCs, and role permission boundaries across heartbeats, batched events, incident review transitions, overrides, and Admin retention purge.
  - **Live PostgreSQL & RPC Suite (`describe.skipIf(!hasLiveSupabase)`):** Verified against live local Supabase (`000001`–`000010`).
- **Phase 6 Distributed Rate-Limiting & Cloud PostgreSQL Suites (`tests/integration/phase6-login-rate-limit.test.ts`):**
  - Verifies distributed PostgreSQL token bucket (`consume_rate_limit`, `reset_rate_limit_bucket`), shared NAT IP cohort burst allowance (`4/4` parallel logins), failed-login penalty throttling, account-specific throttling, and privilege revocation from unprivileged roles (`REVOKE ALL FROM PUBLIC, anon, authenticated`).
  - Total test suite: **22 files / 96 tests** passing with zero skips when `RUN_LIVE_DB_TESTS=true`. Live cloud PostgreSQL 17 integration suites verify 30 tests directly on `hqoxqmmkysnnneqlepuj`. Live Production E2E tests run on `https://ujiankita-three.vercel.app`.

---

## 3. Running Live Database Integration & Load Tests (Non-Production Only)

Provide isolated local or test-project environment variables (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, or `.env.local` for local Supabase) after applying migrations `000001` through `000010`:

```bash
RUN_LIVE_DB_TESTS=true npm run test
```

See [`docs/LOCAL_SUPABASE_SETUP.md`](LOCAL_SUPABASE_SETUP.md) for local Docker Supabase CLI commands (`supabase start`, `supabase db reset`). Note: both load harnesses support `LOAD_TEST_TOKENS_FILE` / `LOAD_TEST_SESSIONS_FILE` in addition to `*_JSON` env vars to avoid Windows 32 KB `CreateProcess` environment block limits across 100+ session cookies:

```bash
npx tsx scripts/load-test-monitoring.ts --dry-run
```

For an isolated staging or local 100-student benchmark:

```bash
LOAD_TEST_CONFIRM_ISOLATED=true \
TARGET_BASE_URL=http://127.0.0.1:3100 \
LOAD_TEST_EXAM_ID=<exam-uuid> \
LOAD_TEST_TOKENS_FILE=/path/to/tokens.json \
npx tsx scripts/load-test-exam-engine.ts
```

---

## 4. Playwright Browser & Accessibility Matrix (`foundation.spec.ts`, `phase3-exam-flow.spec.ts`, `phase4-monitoring.spec.ts` & `phase5-authenticated-workflows.spec.ts`)

Runs across 3 configured browser projects against `npm run build` via `npm run test:e2e` (`playwright.config.ts`):
1. **`desktop-chromium`**
2. **`mobile-android`** (`Pixel 7`)
3. **`mobile-iphone`** (`iPhone 13` WebKit — executed on Linux/Ubuntu CI runners; fails at launch on Windows hosts missing system WebKit DLL dependencies with `exitCode=3221225501`)

Verifies security headers (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), `Cache-Control: no-store` on student/grading/monitoring APIs, zero horizontal overflow across desktop and mobile (`390x844`) viewports, fail-closed redirects to `/login`, fail-closed API responses, authenticated student exam -> reload resume -> essay blur -> review -> submit receipt -> teacher manual grading & release -> live monitoring flows (`phase5-authenticated-workflows.spec.ts`, auto-enabled when `.env.local` / Supabase env is present, skipped cleanly in DB-less CI), zero uncaught `pageerror` exceptions, and zero WCAG 2.2 AA `@axe-core/playwright` violations. *(Note: Playwright Pixel 7 and iPhone 13 profiles emulate responsive WebKit/Chromium viewports and do not substitute for physical ExamBro APK or SEB iOS/macOS WebView hardware verification.)*

---

## 5. Phase A Responsive, Screenshot & WCAG 2.1 AA Test Suites (`capture-screenshots.spec.ts` & `phase-a-accessibility.spec.ts`)

Phase A introduces dedicated automated verification for mobile usability, responsive layouts, and accessibility:
1. **Visual Screenshot Regression Suite (`tests/e2e/capture-screenshots.spec.ts`):**
   - Captures full-page screenshots across 8 standard device viewports (`320px`, `360px`, `375px`, `390px`, `430px`, `768px`, `1024px`, `1440px`).
   - Generates 88 baseline screenshots (`docs/screenshots/baseline/`) and 88 redesign screenshots (`docs/screenshots/redesign/`).
   - Covers Landing, Login, Forgot Password, Not Found, Exam Player, Instructions, Review, Receipt, Question Bank, Student Management, and Monitoring Center.
   - Run via:
     ```bash
     $env:SCREENSHOT_STAGE="redesign"; npx playwright test tests/e2e/capture-screenshots.spec.ts --project=desktop-chromium
     ```
2. **Automated Accessibility & Overflow Suite (`tests/e2e/phase-a-accessibility.spec.ts`):**
   - Audits WCAG 2.1 AA compliance via `@axe-core/playwright` with 0 critical or serious violations.
   - Enforces zero horizontal scrollbar (`document.documentElement.scrollWidth <= document.documentElement.clientWidth`) across all 8 viewport widths from 320px to 1440px.
   - Run via:
     ```bash
     npx playwright test tests/e2e/phase-a-accessibility.spec.ts --project=desktop-chromium
     ```
