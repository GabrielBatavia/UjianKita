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
- `ui-components.test.tsx` & `phase2-ui.test.tsx` — Client component behavior (`LoginForm`, `getNavItemsForRole` across Phase 1–3 menus, `QuestionEditor`, `ExamPreviewClient` desktop/mobile toggle & answer-key safety).

### Integration Suites (`tests/integration/`)
- `api-boundaries.test.ts` — Unauthenticated fail-closed API responses for Phase 1 routes + conditional live RLS verification (`hasLiveSupabase`).
- `phase2-api-and-rls.test.ts` — Unauthenticated fail-closed checks, mocked Phase 2 RBAC/subject/class/lock checks, safe student preview projection checks + conditional live RLS (`hasLiveSupabase`).
- `phase3-exam-engine.test.ts`:
  - **Offline Route Boundary Tests:** Verifies unauthenticated callers fail closed (`401`/`503`) on all Phase 3 student, grading, release, and admin cancel endpoints, and verifies HTTP mapping for `SaveAckOutcome` (`200` `COMMITTED`, `409` `STALE_REVISION_REJECTED`, `410` `DEADLINE_EXPIRED`, `403` `ATTEMPT_CANCELLED`) with `Cache-Control: no-store`.
  - **Offline Mocked Service-Boundary Tests:** Verifies non-student rejection, unpublished/expired eligibility fail-closed checks, order-independent canonical hash computation for `multiple_choice`, audit deduplication on submit replay, subject ownership on grading, mandatory adjustment reasons, and admin-only attempt cancellation.
  - **Live Supabase PostgreSQL RLS & RPC Suite (`describe.skipIf(!hasLiveSupabase)`):** Automatically skipped when `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` are unset. Must be executed against a real PostgreSQL / Supabase instance before declaring end-to-end DB readiness.

---

## 3. Running Live Database Integration & Load Tests (Non-Production Only)

Provide isolated test-project environment variables (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`) after applying migrations `000001` through `000007`:

```bash
TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_ROLE_KEY=... npm run test
```

If local Docker is available, run `npx supabase start` and apply `supabase/migrations/` locally rather than touching production databases.

To run the reproducible ~100-student load benchmark (`scripts/load-test-exam-engine.ts`) against an isolated local/staging deployment:

```bash
LOAD_TEST_CONFIRM_ISOLATED=true \
TARGET_BASE_URL=http://127.0.0.1:3000 \
LOAD_TEST_EXAM_ID=<exam-uuid> \
LOAD_TEST_TOKENS_JSON='[{"cookie":"sb-..."}]' \
npx tsx scripts/load-test-exam-engine.ts
```

---

## 4. Playwright Browser & Accessibility Matrix (`foundation.spec.ts` & `phase3-exam-flow.spec.ts`)

Runs 24 tests (`8 tests × 3 projects`) against `npm run build` via `npm run test:e2e` (`playwright.config.ts`):
1. **`desktop-chromium`**
2. **`mobile-android`** (`Pixel 7`)
3. **`mobile-iphone`** (`iPhone 13` WebKit)

Verifies security headers (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), `Cache-Control: no-store` on all Phase 3 student/grading APIs, zero horizontal overflow across public/mobile ExamBro (`390x844`) viewports, fail-closed redirects to `/login` across Phase 1, Phase 2, and Phase 3 portals (`/teacher/grading/*`, `/student/exams/*`, `/student/attempts/*`, `/student/results`), fail-closed API responses, zero uncaught `pageerror` exceptions, and zero WCAG 2.2 AA `@axe-core/playwright` violations.
