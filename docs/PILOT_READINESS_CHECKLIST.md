# School Pilot Readiness Checklist (Phase 6.5)

This checklist defines the operational gates required before moving from the current **Closed Evaluation / Staging Environment** to an **Official School Examination Pilot**.

---

## 1. System Readiness Status

| Gate Area | Requirement | Current Status | Notes / Blockers |
|---|---|---|---|
| **Core Web CBT Engine** | Next.js 16 App Router + Supabase PG 17 | **READY** | All 11 migrations verified live at `https://ujiankita-three.vercel.app`. |
| **Authentication & RBAC** | School-controlled staff and student logins | **READY** | Self-signup disabled; RLS verified on PostgreSQL 17. |
| **Distributed Rate Limiting** | PostgreSQL-backed login burst protection | **READY** | Tested against shared school Wi-Fi NAT cohorts. |
| **Autosaving & Grading** | Real-time answer commits & manual grading | **READY** | Monotonic revisions, offline recovery queue, and grade adjustment audit verified. |
| **Latency & Co-location** | Regional latency < 500ms | **READY** | Mumbai serverless region (`bom1`) co-located with database (`p50 = 269ms`). |
| **Physical Hardware Attestation** | Android ExamBro & iOS Safe Exam Browser | **PENDING** | Emulated viewports verified; physical device APK/IPA pilot required. |
| **Multi-Proctor Realtime Load** | 100+ concurrent students streaming presence | **PENDING** | Local load test passed; live cloud soak test pending. |
| **Staff MFA Enforcement** | TOTP multi-factor authentication | **PENDING** | Recommended for administrative accounts prior to high-stakes exams. |
| **Infrastructure Sizing** | Commercial tier sizing (Supabase Pro) | **PENDING** | Free tier auto-pauses after 7 days; upgrade required before exam day. |

---

## 2. Supervised School Pilot Protocol

Before conducting a pilot with real students in an actual school building:

1. **Pre-Pilot Hardware Check (T-7 Days):**
   - Execute the test protocol in [`docs/SECURE_BROWSER_DEVICE_TEST_PLAN.md`](SECURE_BROWSER_DEVICE_TEST_PLAN.md) on a sample of at least 5 Android phones running `com.dekikurnia.exambro` and 5 iOS devices running Safe Exam Browser.
2. **Infrastructure Verification (T-48 Hours):**
   - Ensure Supabase instance is active and has not entered a free-tier sleep state.
   - Run a health check via `GET https://ujiankita-three.vercel.app/api/health`.
3. **School Wi-Fi NAT Testing (T-24 Hours):**
   - Connect 10 student devices to the school Wi-Fi access point and perform simultaneous logins to confirm the access point does not throttle or drop WebSocket/REST connections.
4. **Staff Roles Provisioning:**
   - Provision school Administrator, Teachers, and Proctors using official school email addresses.
   - Do not use synthetic or placeholder email addresses for real school staff.
5. **Exam Publication:**
   - Create and validate the examination draft, schedule class windows, and publish the atomic snapshot.
   - Verify published version immutability.
