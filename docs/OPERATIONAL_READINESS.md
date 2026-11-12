# UjianKita — Cloud Operational Readiness & Architecture Guide (Phase 6)

This document records the live cloud topology, verified Phase 6 staging benchmarks, regional latency analysis, distributed rate limiting configuration, operational runbooks, and remaining pre-production gates before enabling official school examinations.

---

## 1. Environment Topology & Isolation Matrix

| Environment | Hosting / Branch | Supabase Project | Purpose & Status |
|---|---|---|---|
| **Local Development** | `localhost:3000` / `127.0.0.1:3100` (`feat/phase-6-cloud-integration`) | Local Docker Supabase (`db.major_version = 15`) | Automated integration tests (`96/96`), Playwright Chromium & Pixel 7 suites, local 100-student load benchmark. |
| **Cloud Preview (Staging)** | Vercel `gabrielbatavia7-2132s-projects/ujiankita` (`feat/phase-6-cloud-integration` branch-scoped env) | `hqoxqmmkysnnneqlepuj` (`South Asia / Mumbai`, PostgreSQL `17.11`) | Verified end-to-end against PostgreSQL 17 with `migrations/20261112000001`–`20261112000011`, distributed login rate limiting, and Playwright/HTTPS API tests. |
| **Cloud Production (Pre-Cutover)** | `https://ujiankita-three.vercel.app` (`main` branch, `iad1` default) | *Currently still pointing to older project `amgfceevbpcyyphnpaeh`* | **Do not use for real exams until cutover is approved**, Production env vars are updated to the target Production Supabase project (`hqoxqmmkysnnneqlepuj` or a fresh clean Production DB), and `main` is promoted. |

---

## 2. Measured Cloud Latency & Serverless Region Recommendation

Because `hqoxqmmkysnnneqlepuj` resides in **South Asia (`ap-south-1`, Mumbai)** while the Vercel `ujiankita` project currently defaults to **US East (`iad1`, Washington, D.C.)**, cross-continent database hops dominate API latency unless serverless compute is co-located.

### Observed Phase 6 Cloud Measurements

| Endpoint / Path | Vercel Function Region | Supabase Region | Measured Warm RTT (5 samples) | Mean RTT |
|---|---|---|---|---|
| Direct Supabase REST (`GET /rest/v1/`) | N/A (direct HTTPS) | `ap-south-1` (Mumbai) | `340 ms` (TLS cold), `39 ms`, `23 ms` | `134 ms` (steady ~`31 ms`) |
| Vercel Preview `/api/health` (`dpl_GAaEhXDGUSj4TiuAUKkDiBaAf22x`) | `iad1` (US East) | `ap-south-1` (Mumbai) | `746`, `812`, `1106`, `717`, `728 ms` *(earlier burst: `1050–1192 ms`)* | **`822 ms`** (`1121 ms` earlier burst) |
| Vercel Preview `/api/health` (`dpl_3xuvYymEfCPV3AjYD4uMBsesCdVn`, `--regions bom1`) | `bom1` (Mumbai) | `ap-south-1` (Mumbai) | `592` (1st edge), **`305`, `300`, `310`, `293 ms`** | **`360 ms`** (**`~302 ms` steady**) |

### Recommendation for Official School Exams (Indonesia)

1. **Immediate Alignment (if keeping `hqoxqmmkysnnneqlepuj` in Mumbai):** Change the Vercel `ujiankita` Function Default Region from `iad1` to **`bom1` (Mumbai)** in Vercel Dashboard (`Settings -> Functions`) or via `vercel.json` (`"regions": ["bom1"]`). Multi-query endpoints (`auth.getUser()` + profile check + RPC + audit) otherwise pay ~`250–300 ms` per sequential query across US–India links.
2. **Optimal Indonesian Classroom Latency (Recommended for Dedicated Production):** Provision the dedicated Production Supabase project in **Singapore (`ap-southeast-1`)** and set Vercel Function Region to **`sin1` (Singapore)** so both student client↔Vercel (~`20–60 ms` from Java/Indonesia) and Vercel↔PostgreSQL (~`2–10 ms`) remain minimal.

---

## 3. Authentication & Distributed Rate Limiting

- **School-Controlled Accounts:** Supabase Auth `enable_signup` is set to `false` on `hqoxqmmkysnnneqlepuj` (`auth.signUp()` rejected with HTTP `422: Signups not allowed for this instance`). All teacher and student accounts are provisioned by authenticated school administrators using `SUPABASE_SERVICE_ROLE_KEY` server-side.
- **Configured Redirect URLs:** `auth.site_url = "https://ujiankita-three.vercel.app"`, with explicit `additional_redirect_urls` for production `/auth/callback` & `/reset-password`, trusted team Preview URLs (`https://*-gabrielbatavia7-2132s-projects.vercel.app/*`), and localhost callbacks.
- **Distributed PostgreSQL Token Bucket (`20261112000011_phase6_distributed_rate_limiting.sql`):**
  - Uses `public.api_rate_limits` and `SECURITY DEFINER` RPCs `consume_rate_limit` / `reset_rate_limit_bucket` (executable **only** by `service_role`; `PUBLIC`, `anon`, and `authenticated` privileges explicitly revoked).
  - `/api/auth/login` uses distributed PostgreSQL counters tuned for school Wi-Fi NAT cohorts over a 5-minute window (`LOGIN_IP_TOTAL_BURST_LIMIT = 300`, `LOGIN_IP_FAILURE_LIMIT = 25`, `LOGIN_EMAIL_BURST_LIMIT = 20`, `LOGIN_EMAIL_FAILURE_LIMIT = 8`) so simultaneous legitimate student logins behind one shared IP succeed without false `429` lockouts, while repeated invalid credential attempts from an IP or against an email are throttled across serverless workers.

---

## 4. Database Migrations, Backup/PITR & Free-Tier Operational Risks

### Safe Migration Rules
- Apply schema changes strictly via `supabase db push --remote` (never `supabase db reset --linked` or `supabase/seed.sql` on Production).
- Never run `supabase config push` with the entire local `supabase/config.toml` when local Docker runs PostgreSQL `15` and hosted Supabase runs PostgreSQL `17`; pass an isolated config file containing only targeted `auth.*` properties.

### Supabase Free Tier Operational Warning
- **7-Day Inactivity Pause:** Supabase Free-Tier projects automatically pause after ~7 days of zero traffic, causing multi-minute cold recovery or downtime right before an exam morning. Upgrade to **Supabase Pro** before official school exams for **no auto-pause**, **automated daily backups**, **Point-in-Time Recovery (PITR)**, and dedicated connection pooling (`Supavisor`).

---

## 5. Pre-Exam Day Checklist & Secret Rotation SOP

### T-24 Hours Before Official Exam
1. Confirm `GET /api/health` returns `status: "healthy"`, `phase: "phase-6"`, and `supabase.reachable: true`.
2. Confirm `VERCEL` Function region matches Supabase region (`bom1`↔`ap-south-1` or `sin1`↔`ap-southeast-1`).
3. Verify zero paused Supabase instance status and review recent Vercel function error logs.
4. Confirm physical student devices (Android `ExamBro` / iOS/Desktop Safe Exam Browser) passed the school pilot against the live HTTPS target when `VERIFIED_SEB_REQUIRED` or `BEST_EFFORT_EXAMBRO` is enabled (see [`docs/SECURE_BROWSER_DEVICE_TEST_PLAN.md`](SECURE_BROWSER_DEVICE_TEST_PLAN.md)).
5. Export/verify an up-to-date logical database backup prior to exam window open.

### Secret Rotation SOP
1. **If `SUPABASE_SERVICE_ROLE_KEY` or preview secrets are suspected exposed:** Rotate `service_role` in Supabase Dashboard (`Project Settings -> API`), immediately update encrypted Vercel Production & branch-scoped Preview env vars, and trigger a fresh Vercel deployment so running lambdas pick up the new key.
2. Never add `SUPABASE_SERVICE_ROLE_KEY` to wildcard `*` unreviewed preview branches.
