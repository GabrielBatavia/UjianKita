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
- `authorization.test.ts` — Phase 1 & Phase 2 RBAC permissions (`questions.*`, `exams.*`), school isolation, redirect sanitization.
- `schemas.test.ts` — Zod validation for auth, academic administration, and Question Bank / Exam inputs.
- `security-and-rate-limit.test.ts` — Safe error mapping and sliding-window throttling behavior.
- `exam-contracts.test.ts` — Phase 3 attempt state machine and revision/idempotency contracts.
- `question-bank.test.ts` — Domain validation for `single_choice`, `multiple_choice`, `true_false`, and `essay`, fingerprint deduplication, and `renderSafeQuestionHtml` XSS neutralization + KaTeX rendering.
- `import-parser.test.ts` — CSV & Excel (`.xlsx`) template generation/parsing, formula cell rejection, formula prefix rejection, duplicate detection, file extension/size limits.
- `exam-lifecycle.test.ts` — Status transitions (`DRAFT -> READY_FOR_REVIEW -> PUBLISHED -> CLOSED -> ARCHIVED`, explicit `PUBLISHED -> DRAFT`), readiness checklist, cross-exam class schedule conflict detection, and deterministic shuffle seed stability with pinned items.
- `ui-components.test.tsx` & `phase2-ui.test.tsx` — Client component behavior (`LoginForm`, `QuestionEditor`, `ExamPreviewClient` desktop/mobile toggle & answer-key safety).

### Integration Suites (`tests/integration/`)
- `api-boundaries.test.ts` — Unauthenticated fail-closed API responses for Phase 1 routes + conditional live RLS verification (`hasLiveSupabase`).
- `phase2-api-and-rls.test.ts`:
  - **Offline Route Boundary Tests:** Verifies unauthenticated callers fail closed (`401`/`503`) on `/api/teacher/questions`, `/api/teacher/exams`, `/api/teacher/exams/[id]/publish`, `/api/teacher/exams/[id]/preview`, and `/api/admin/exams`.
  - **Offline Mocked Service-Boundary Tests:** Uses mocked Supabase query builders at the test boundary to verify:
    1. `student` role receives `403 FORBIDDEN` across Question Bank and Exam mutations.
    2. `teacher` access to unassigned subjects (`SUBJECT_FORBIDDEN`) or unassigned classes (`CLASS_FORBIDDEN`) is rejected with `403`.
    3. Stale `version_lock` writes return `409 CONCURRENCY_CONFLICT`.
    4. `buildStudentSafeExamPreview()` never queries `exam_version_answer_keys` / `question_answer_keys` and strips explanations, scoring policies, and grading rubrics from both draft and published projections.
  - **Live Supabase PostgreSQL RLS & RPC Suite (`describe.skipIf(!hasLiveSupabase)`):** Automatically skipped when `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, and `TEST_SUPABASE_SERVICE_ROLE_KEY` are unset. Must be executed against a real PostgreSQL / Supabase instance before declaring end-to-end DB readiness.

---

## 3. Running Live Database Integration Tests (Non-Production Only)

Provide isolated test-project environment variables (`TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`) after applying migrations `000001` through `000005`:

```bash
TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... TEST_SUPABASE_SERVICE_ROLE_KEY=... npm run test
```

If local Docker is available, run `npx supabase start` and apply `supabase/migrations/` locally rather than touching production databases.

---

## 4. Playwright Browser & Accessibility Matrix (`tests/e2e/foundation.spec.ts`)

Runs against `npm run build` via `npm run test:e2e` across three projects (`playwright.config.ts`):
1. **`desktop-chromium`**
2. **`mobile-android`** (`Pixel 7`)
3. **`mobile-iphone`** (`iPhone 13` WebKit)

Verifies security headers (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), zero horizontal overflow on landing/auth views, fail-closed redirects to `/login` across Phase 1 and Phase 2 portal routes (including `/teacher/questions/*`, `/teacher/exams/*`, `/teacher/schedules`, `/admin/exams/*`), fail-closed API responses, zero uncaught `pageerror` exceptions, and zero WCAG 2.2 AA `@axe-core/playwright` violations on public auth entry points.
