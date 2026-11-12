# Production Deployment Verification Report (Phase 6.5)

This report validates the live production deployment of **UjianKita** at `https://ujiankita-three.vercel.app` after the Phase 6.5 controlled cutover.

---

## 1. Deployment Metadata & Target Information

- **Canonical URL:** `https://ujiankita-three.vercel.app`
- **Vercel Project:** `ujiankita` (`prj_4vtJMVrKdO0ggXelrEsUnPrMPP5R`)
- **Vercel Team:** `gabrielbatavia7-2132s-projects`
- **Active Deployment ID:** `dpl_52niSJDEXy7RVBJiJgyCVo2sQTKu`
- **GitHub Repository:** `https://github.com/GabrielBatavia/UjianKita`
- **Deployed Commit:** `7be77ff` (Merged PR #7 from branch `feat/phase-6-cloud-integration`)
- **Effective Serverless Region:** `bom1` (Mumbai, India)
- **Supabase Project:** `hqoxqmmkysnnneqlepuj` (PostgreSQL `17.11`, `ap-south-1` Mumbai)
- **Applied Database Migrations:** `20261112000001` through `20261112000011` (`11/11` confirmed, zero pending)

---

## 2. Infrastructure Health & Security Header Audit

`GET https://ujiankita-three.vercel.app/api/health` returned:
```json
{
  "status": "healthy",
  "service": "ujiankita-web",
  "phase": "phase-6",
  "timestampUtc": "2026-11-12T17:26:05.904Z",
  "supabase": {
    "configured": true,
    "serviceRoleConfigured": true,
    "reachable": true,
    "error": null
  }
}
```

### Response Headers
- `HTTP/2 200 OK`
- `x-vercel-id: hkg1::bom1::m7cd8-1794504365668-ab7d1a349f2e` (Serverless compute verified in `bom1`)
- `content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests;`
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `x-frame-options: DENY`
- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`

---

## 3. Automated End-to-End Examination Results on Live Production

Executed against `https://ujiankita-three.vercel.app` using synthetic batch tag `7199f20e`:

| Stage | Verification Details | Result |
|---|---|---|
| **1. Health Check** | Verified `HTTP 200 healthy`, `phase-6`, PostgreSQL reachable in Mumbai. | **PASSED** |
| **2. Administrator Setup** | Admin authenticated via `/api/auth/login`; created academic year `2026/2027`, subject `Informatika`, class `X-1`, teacher account, student account, and teacher assignment. | **PASSED** |
| **3. Teacher Examination Publication** | Teacher logged in; created 1 single-choice (50 pts) + 1 essay question (50 pts); created exam draft, attached questions, scheduled window, validated readiness, and published atomic snapshot. | **PASSED** |
| **4. Multi-School Access Isolation** | Admin B logged in; attempted to access School A's exam and received `404`/`403`; queried `/api/admin/students` and received 0 student records from School A. | **PASSED** |
| **5. Playwright Headless Browser UI** | Headless Chromium visited `https://ujiankita-three.vercel.app`: verified Phase 6 landing page, verified `/student` unauthenticated redirect to `/login`, performed interactive form login, and navigated to `/student` with 0 console `pageerror`s. | **PASSED** |
| **6. Student Examination Lifecycle** | Student authenticated; confirmed student direct RLS read of `question_answer_keys` and `exam_version_answer_keys` returned 0 rows; simulated 4-student same-IP NAT burst (all `200`); started attempt (confirmed zero answer keys leaked in payload); sent presence heartbeat and telemetry events; autosaved single-choice option `B` and essay response; submitted with acknowledgment; retrieved immutable submission receipt. | **PASSED** |
| **7. Grading, Release & Monitoring** | Teacher monitoring reflected submitted student attempt; teacher graded essay (`40/50`); teacher released results; student queried `/api/student/results` and verified final score `90`; verified directly in PostgreSQL that `exam_attempts.status = 'SUBMITTED'` and `exam_grades.total_score = 90` with `release_status = 'RELEASED'`. | **PASSED** |

---

## 4. Latency Benchmarks (Production in `bom1`)

- **Vercel `/api/health` Warm Samples:** `262 ms`, `260 ms`, `216 ms`, `255 ms`, `237 ms` (Average: **`246 ms`**)
- **Direct Supabase REST Warm Samples:** `330 ms`, `44 ms`, `19 ms` (Average: **`131 ms`**)

---

## 5. Post-Verification Account Lockdown

All synthetic test accounts and schools provisioned during the test run were deactivated and permanently locked:
- **`activeSchools`: 0** (All test school records set to `is_active = false`).
- **`activeUserProfiles`: 0** (All test profiles set to `is_active = false`).
- **`bannedSyntheticUsers`: 26** (`ban_duration: "876000h"` / ~100 years in Supabase Auth).
- **`apiRateLimitsRemaining`: 0** (Rate limit table purged of test keys).
- **Immutable audit residual:** 101 records retained in append-only `audit_events` and 9 attempts in `exam_attempts` due to database trigger immutability.
