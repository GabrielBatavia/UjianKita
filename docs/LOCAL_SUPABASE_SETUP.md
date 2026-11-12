# Local Supabase Setup & Verification Workflow

This guide documents how to run **UjianKita** against an isolated **local Docker Supabase** instance without provisioning cloud Supabase or Vercel services.

> **Windows Safety Warning:** If the host machine already runs a local Windows PostgreSQL service (e.g., `postgresql-x64-14` on port `5432`), **do not** modify or stop it. The local Supabase CLI stack runs isolated inside Docker on ports **`54321`** (Kong API gateway) and **`54322`** (PostgreSQL `postgres:15.19.0.018`). Also prefer invoking the installed `supabase.exe` binary directly on Windows instead of `npx supabase` if NPM wrapper execution stalls.

---

## 1. Prerequisites

- Docker Desktop running cleanly (Linux containers)
- Supabase CLI (`%LOCALAPPDATA%\supabase\bin\supabase.exe` on Windows, or `supabase` in `$PATH`)
- Node.js 22+ and `npm`

---

## 2. Start Local Supabase & Apply Migrations (`000001`–`000010`)

From the repository root (`D:\UjianKita`):

```powershell
# Start local Docker Supabase services
& "$env:LOCALAPPDATA\supabase\bin\supabase.exe" start

# Inspect local URL and keys
& "$env:LOCALAPPDATA\supabase\bin\supabase.exe" status -o env
```

Active local service endpoints:
- **API Gateway (`NEXT_PUBLIC_SUPABASE_URL`):** `http://127.0.0.1:54321`
- **PostgreSQL (`psql`):** `127.0.0.1:54322` (`postgres` database)
- **Supabase Containers:** `supabase_db_ujiankita`, `supabase_auth_ujiankita`, `supabase_rest_ujiankita`, `supabase_kong_ujiankita`, `supabase_realtime_ujiankita`, `supabase_inbucket_ujiankita`

To cleanly recreate the database, apply all 10 migrations (`supabase/migrations/20261112000001`–`20261112000010`), and load `supabase/seed.sql`:

```powershell
& "$env:LOCALAPPDATA\supabase\bin\supabase.exe" db reset
```

---

## 3. Configure `.env.local` (Never Commit)

Copy `.env.example` to `.env.local` (`.env.local` is ignored by Git) and populate the local Supabase values printed by `supabase status -o env`:

- `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100` (or `http://localhost:3000` for `npm run dev`)
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<local ANON_KEY>`
- `SUPABASE_SERVICE_ROLE_KEY=<local SERVICE_ROLE_KEY>`
- Optional test overrides (read by `tests/integration/` when `.env.local` isn't auto-loaded): `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `TEST_SUPABASE_SERVICE_ROLE_KEY`

> Note on local HTTP vs HTTPS headers: `next.config.ts` detects localhost HTTP (`allowHttpLocalhost`) so local Chromium/Playwright runs do not fail on `upgrade-insecure-requests` / `HSTS` or local `ws://127.0.0.1:54321` Realtime sockets. Production HTTPS deployments keep strict CSP and HSTS enabled.

---

## 4. Run Full Local Live-DB & E2E Verification

```powershell
# 1. Static checks
npm run lint
npm run typecheck

# 2. All Vitest unit + live PostgreSQL RLS/RPC integration suites (21 files, 92 tests)
$env:RUN_LIVE_DB_TESTS = "true"
npm run test

# 3. Production Next.js build + Chromium/Pixel 7 Playwright E2E suite (24 tests)
$env:NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3100"
npm run build
npx playwright test --project=desktop-chromium --project=mobile-android --workers=1
```

After verifying tests or running load benchmarks, run `supabase db reset` if you want to purge any leftover synthetic records cleanly.
