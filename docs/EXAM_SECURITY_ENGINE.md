# UjianKita Phase 4 — Examination Security Engine

## 1. Design Principles & Non-Negotiable Invariants

UjianKita's examination security architecture balances integrity visibility for teachers with operational reliability and fairness for Indonesian schools:

1. **Decoupled from Answer Persistence:** Monitoring heartbeats (`POST /api/student/attempts/[attemptId]/heartbeat`), batched client events (`POST /api/student/attempts/[attemptId]/events`), and incident classification execute independently of `save_attempt_answer_atomic` and `submit_exam_attempt_atomic`. Telemetry failures or offline disconnects **never** lose answers or block exam submission.
2. **Honest Evidence Provenance (`MonitoringEventSource`):**
   - `SERVER_CONFIRMED`: Session start/resume/submission/expiry, Safe Exam Browser cryptographic key verification (`SEB_VERIFICATION_SUCCEEDED` / `SEB_VERIFICATION_FAILED`), and audited staff overrides (`BROWSER_POLICY_OVERRIDE_GRANTED`).
   - `SERVER_INFERRED`: Missed heartbeat staleness transitions (`CONNECTION_GAP_OBSERVED`) detected when `last_heartbeat_at_utc` exceeds `stale_threshold_seconds`.
   - `CLIENT_REPORTED`: Tab visibility changes (`EXAM_PAGE_HIDDEN` / `EXAM_PAGE_VISIBLE`), client-recovered reloads (`EXAM_PAGE_RELOADED`), and non-editable prompt copy/context-menu attempts (`COPY_EVENT_OBSERVED`, `CONTEXT_MENU_EVENT_OBSERVED`). Clients can **never** inject `SERVER_CONFIRMED` records or self-promote `browser_trust_level`.
3. **Zero Automatic Penalties:** Monitoring events and security incidents never alter `exam_grades`, forfeit attempts, or display accusatory "cheating" labels. Human review via `incident_review_actions` is mandatory.

## 2. Browser Enforcement Policies & Immutable Publish Snapshots

Per-exam policies are configured in `public.exam_security_policies` and snapshotted immutably into `public.exam_security_policy_versions` whenever `publish_exam_atomic` creates an `exam_versions` row (`trg_snapshot_security_policy_on_publish` in migration `000009`).

| Policy (`BrowserEnforcementPolicy`) | Start / Resume Enforcement | Workspace Payload Enforcement | Recommended Use |
| :--- | :--- | :--- | :--- |
| `STANDARD_BROWSER_ALLOWED` | Allowed on all browsers | Allowed | Daily quizzes / open-device sessions |
| `SECURE_BROWSER_RECOMMENDED` | Allowed; surfaces ExamBro QR & SEB launch guidance | Allowed; records honest hints | Mixed BYOD Android + iOS environments |
| `VERIFIED_SEB_REQUIRED` | Requires verified SEB key proof OR active staff override (`403 SEB_VERIFICATION_REQUIRED`) | Requires `seb_verified_at_utc` OR active override (`403`) | Controlled lab / iPad SEB examinations |

## 3. Prompt-Scoped Guards & Dynamic Watermark

- **Prompt-Only Copy/Selection Guard:** When `copy_paste_guard_enabled` is true, `[data-exam-prompt="true"]` containers apply `select-none`, intercept `onCopy` / `onContextMenu` on non-editable question stems, and queue neutral telemetry events. Essay `<Textarea>` elements, radio/checkbox labels, keyboard focus navigation, screen-reader attributes, and `"Tinjau & Kumpulkan"` controls remain completely unblocked.
- **Accessible Watermark (`StudentExamWatermark`):** Semi-transparent diagonal overlay (`pointer-events-none`, `aria-hidden="true"`, opacity clamped `0.03..0.18`) stamped with student display name, short attempt code, and time. UjianKita explicitly documents that web CSS/JS **cannot prevent OS-level screenshots**; mobile screenshot blocking is delegated to native Android `FLAG_SECURE` (ExamBro) or iOS Safe Exam Browser.

## 4. Phase 3 Security Audit Gaps Remediated in Phase 4

| Gap Found Before Phase 4 | Remediation Implemented |
| :--- | :--- |
| `attempt_events` lacked JSON payload bounds & client deduplication | Added `client_event_id`, partial unique index `idx_attempt_events_dedupe`, 2048-byte Zod & SQL size limits, max-25 batching, and atomic RPC `record_monitoring_events_batch_atomic`. |
| `require_exam_browser` flag had no server-side enforcement | Enforced `VERIFIED_SEB_REQUIRED` server-side via `enforceBrowserPolicyOnExamAccess` in `start/route.ts`, `attempts/[attemptId]/route.ts`, and SSR attempt page (`[attemptId]/page.tsx`). |
| `attempt_events` student SELECT exposed all event types | Tightened `attempt_events_student_select` RLS in `000009` and stored sensitive SEB hashes & incidents strictly in staff-only tables. |
| Missing student privacy transparency notice | Added Bahasa Indonesia privacy disclosure to `StudentExamInstructions` & `StudentExamSecurityCard`. |
