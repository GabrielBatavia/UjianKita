# UjianKita Phase 4 — Real-Time Monitoring Control Center

## 1. Architecture Overview (100+ Concurrent Students)

To avoid database write amplification during 100-student examinations, live connection tracking and activity logs are separated cleanly:

1. **Compact Latest-Seen State (`public.attempt_monitoring_presence`):** One row per `exam_attempt`, updated via `INSERT ... ON CONFLICT DO UPDATE` by `record_attempt_heartbeat_atomic`. Periodic heartbeats never append permanent rows to `attempt_events`.
2. **Jittered Heartbeat Cadence:** `ExamPlayerClient` dispatches heartbeats every `heartbeatIntervalSeconds` (default `30s`) plus random client jitter (`±2000ms`) so 100 students starting simultaneously distribute load evenly.
3. **Bounded Batched Telemetry (`record_monitoring_events_batch_atomic`):** UI visibility, copy, and reload signals accumulate in a client queue and flush every 8 seconds (up to 25 events per request) or on `pagehide` via `navigator.sendBeacon()` / `fetch(..., { keepalive: true })`.
4. **Live Updates + Polling Fallback (`TeacherExamControlCenter`):**
   - Subscribes to Supabase Realtime `postgres_changes` on `attempt_monitoring_presence` and `exam_security_incidents` filtered by `exam_id=eq.${examId}`.
   - Automatically falls back to / pairs with a 15-second `GET /api/teacher/monitoring/[examId]` refresh cycle so proctors retain visibility even behind restrictive school proxies blocking WebSockets.

## 2. Server-Side Connection States (`ConnectionPresenceState`)

Computed server-side by `inferConnectionPresenceState` (`src/domain/monitoring/presence-and-incidents.ts`):

| State | Rule | Operational Meaning |
| :--- | :--- | :--- |
| `ENDED` | `attempt.status IN ('SUBMITTED', 'EXPIRED', 'CANCELLED_BY_ADMIN')` | Session finalized; heartbeat monitoring stops cleanly |
| `UNKNOWN` | Active attempt with `lastHeartbeatAt === null` | Attempt created but player heartbeat not yet received |
| `RECENTLY_SEEN` | `(now - lastHeartbeatAt) <= staleThresholdSeconds` (default `90s`) | Client recently connected |
| `STALE` | `(now - lastHeartbeatAt) > staleThresholdSeconds` | Missed heartbeat window; server logs one `CONNECTION_GAP_OBSERVED` (`SERVER_INFERRED`) transition |

## 3. Portal Routes & Endpoints

- `/teacher/monitoring` & `GET /api/teacher/monitoring` — Active exam monitoring roster
- `/teacher/monitoring/[examId]` & `GET /api/teacher/monitoring/[examId]` — Real-Time Examination Control Center (KPI counts, search, presence/severity filters, emergency overrides, policy editor)
- `/teacher/monitoring/[examId]/students/[attemptId]` & `GET /api/teacher/monitoring/[examId]/students/[attemptId]` — Student chronological timeline & paired hidden/visible duration spans
- `/teacher/monitoring/[examId]/report?format=csv` — Formula-safe CSV + printable security summary
- `/admin/monitoring` & `/admin/monitoring/[examId]` — School-wide proctor/admin oversight & retention controls

## 4. Load-Test Harness

`scripts/load-test-monitoring.ts` simulates 100 simultaneous students dispatching heartbeats, batched visibility events, and concurrent answer saves. Production targets are protected by requiring `LOAD_TEST_CONFIRM_ISOLATED=true`.
