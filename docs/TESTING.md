# Testing & Quality Assurance

UjianKita enforces automated checks across static typing, linting, unit tests, route authorization boundaries, production builds, and browser E2E / WCAG accessibility audits.

---

## 1. Test Layers

| Layer | Tooling | Location | Purpose |
|---|---|---|---|
| **Static Type Checking** | TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`) | `tsconfig.json` | Eliminates implicit `any`, nullability errors, and unsafe indexing |
| **Linting** | ESLint (`eslint-config-next/core-web-vitals`, `typescript`) | `eslint.config.mjs` | React hooks discipline, Next.js best practices, accessibility lint rules |
| **Unit Tests** | Vitest + React Testing Library | `tests/unit/*.test.ts(x)` | Zod schemas, RBAC policies, tenant boundaries, rate limiter, security helpers, Phase 2 domain state machine, UI form validation |
| **API & Live RLS Tests** | Vitest | `tests/integration/api-boundaries.test.ts` | Unauthenticated fail-closed API checks; optional live Supabase RLS & `audit_events` immutability verification |
| **E2E, Responsive & WCAG** | Playwright + `@axe-core/playwright` | `tests/e2e/foundation.spec.ts` | Security headers, `/api/health`, fail-closed auth redirects, horizontal overflow on Desktop/Android/iPhone viewports, WCAG 2.2 AA rules |

---

## 2. Running Checks Locally

```bash
# 1. Lint & TypeScript
npm run lint
npm run typecheck

# 2. Unit & offline integration suite
npm run test

# 3. Production build check
npm run build

# 4. Playwright E2E + WCAG checks (requires Chromium and WebKit browsers installed)
npx playwright install chromium webkit
npm run test:e2e
```

---

## 3. Running Live Supabase RLS Verification

The integration test file `tests/integration/api-boundaries.test.ts` includes a live PostgreSQL RLS suite that is safely skipped when live test credentials are absent. To execute it against a **synthetic** Supabase test project (never production):

```bash
export TEST_SUPABASE_URL="https://your-test-project.supabase.co"
export TEST_SUPABASE_ANON_KEY="your-test-anon-key"
export TEST_SUPABASE_SERVICE_ROLE_KEY="your-test-service-role-key"
npm run test:integration
```

---

## 4. Reporting Standards

Per project engineering rules:
- Unit test success does **not** certify live Supabase connectivity or RLS enforcement unless live database tests have actually executed against a migrated Supabase instance.
- All test results distinguish between offline/unit verification and live integration verification.
