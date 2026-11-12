# Concurrency & 100-Student Load Benchmark Results

Phase 5 executed both official load test scripts (`scripts/load-test-exam-engine.ts` and `scripts/load-test-monitoring.ts`) against a **live Next.js production server (`npx next start -p 3100`)** connected to **local Docker Supabase PostgreSQL + PostgREST (`127.0.0.1:54321` / `54322`)** on Windows.

---

## 1. Benchmark Conditions & Methodology

- **Concurrency Target:** `100` simultaneous virtual students per drill.
- **Session Provisioning:** Each synthetic student (`user_profiles`, `students`, `class_enrollments`) authenticated via `@supabase/ssr` `signInWithPassword()` directly against local Supabase Auth to issue valid HTTP session cookies (`LOAD_TEST_TOKENS_FILE` / `LOAD_TEST_SESSIONS_FILE` support added for Windows 32 KB environment block compatibility).
- **Important Login Throttling Note:** Authentication cookies were pre-minted against Supabase Auth rather than funneling all 100 simultaneous logins through `POST /api/auth/login`, because `POST /api/auth/login` currently enforces an in-memory per-IP cap (`auth:login:ip`, limit `15` per `5` minutes). See [`PRODUCTION_READINESS_GAPS.md`](PRODUCTION_READINESS_GAPS.md).

---

## 2. Drill 1 — Examination Engine (`scripts/load-test-exam-engine.ts`)

Each of the 100 concurrent virtual students performed:
1. Staggered attempt creation (`POST /api/student/exams/[examId]/start` with randomized 10-question + randomized-option published exam).
2. Workspace retrieval (`GET /api/student/attempts/[attemptId]`).
3. `10` monotonic answer saves (`PUT /answers`) + `1` deliberate duplicate idempotent retry on question 1.
4. Simultaneous double-submit race (`Promise.all([POST /submit, POST /submit])` with matching `idempotencyKey`), asserting identical `receiptCode` values.

### Observed HTTP Latency & Error Metrics

| Phase | Requests Executed | Errors (`status >= 400`) | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `START` | `100` | **`0`** | `3622 ms` | `3959 ms` | `4174 ms` |
| `SAVE` | `1000` (+`100` idempotent Q1 retries) | **`0`** | `1568 ms` | `1849 ms` | `2226 ms` |
| `SUBMIT` (concurrent double-submit race) | `100` pairs (`200` HTTP POSTs) | **`0`** | `2336 ms` | `2806 ms` | `3075 ms` |

- **Result:** **`100/100` succeeded cleanly** (matching `receiptCode` verified across every concurrent double-submit pair).

### Observed PostgreSQL Post-Run Integrity Check

| Table Checked | Expected | Observed |
|---|---|---|
| `exam_attempts` (`total` / `SUBMITTED`) | `100` / `100` | **`100` / `100`** |
| `student_answers` | `1000` (`100` students x `10` items) | **`1000`** |
| `exam_submissions` | `100` | **`100`** |
| `submission_receipts` | `100` | **`100`** |
| `exam_grades` | `100` | **`100`** |

---

## 3. Drill 2 — Security Monitoring & Telemetry (`scripts/load-test-monitoring.ts`)

100 active `IN_PROGRESS` student sessions fired concurrent monitoring + save waves within a `600 ms` jitter window (`heartbeat` -> batched `EXAM_PAGE_HIDDEN`/`EXAM_PAGE_VISIBLE` `events` -> `PUT /answers`):

- **Summary (`ISOLATED_HTTP_LOAD`):** `okCount: 100`, `failedCount: 0`, `totalDurationMs: 4453.2 ms`

| Endpoint Wave | p50 | p95 | Max | Failed |
|---|---|---|---|---|
| `POST /heartbeat` | `1300.78 ms` | `1417.3 ms` | `1588.05 ms` | `0` |
| `POST /events` (batch) | `1446.79 ms` | `1776.4 ms` | `1936.47 ms` | `0` |
| `PUT /answers` | `1403.57 ms` | `1582.83 ms` | `1659.59 ms` | `0` |

### Observed PostgreSQL Post-Run Check

| Table Checked | Expected | Observed |
|---|---|---|
| `attempt_monitoring_presence` | `100` | **`100`** |
| `attempt_events` (`100` `EXAM_STARTED` + `200` batched telemetry) | `300` | **`300`** |
| `student_answers` | `100` | **`100`** |

---

## 4. Concurrency Invariants Verified in Vitest (`tests/integration/phase5-e2e-concurrency-invariants.test.ts`)

- Concurrent `start_or_resume_exam_attempt` calls enforce a single active attempt (`idx_exam_attempts_single_active`).
- Concurrent/out-of-order `save_attempt_answer_atomic` calls reject stale revisions (`STALE_REVISION_REJECTED`) and preserve deterministic revision state.
- Expired attempts auto-finalize both on inline save attempts (`DEADLINE_EXPIRED`) and via batch cron/sweep RPC `finalize_expired_exam_attempts`.
- Monitoring incident creation deduplicates by `(attempt_id, reason_code)` and never mutates `exam_grades`.
