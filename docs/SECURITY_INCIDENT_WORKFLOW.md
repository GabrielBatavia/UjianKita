# UjianKita Phase 4 — Security Incident Review Workflow

## 1. Deduplicated Alert & Incident Synthesis

High-frequency student browser events must not flood teachers with redundant alerts. `exam_security_incidents` enforces a partial unique index `idx_security_incidents_open_dedupe ON (exam_id, dedupe_key) WHERE status IN ('NEW', 'UNDER_REVIEW', 'ACKNOWLEDGED')` with `dedupe_key = 'attempt:' || coalesce(attempt_id, student_id) || ':' || reason_code`.

- Repeated triggers (e.g., 8 visibility switches or recurrent disconnections) increment `occurrence_count`, escalate severity cleanly if thresholds are crossed, and update `last_observed_at_utc` on one grouped incident.
- Incident titles and summaries (`PROLONGED_ABSENCE`, `REPEATED_VISIBILITY_SWITCHES`, `REPEATED_RELOADS`, `COPY_PASTE_BURST`, `PROLONGED_DISCONNECTION`, `BROWSER_POLICY_MISMATCH`, `MANUAL_STAFF_FLAG`) strictly use **neutral, descriptive Indonesian language** noting human review is required.

## 2. State Machine & Immutable Review Audit Trail

Incidents transition cleanly through:
- `NEW` -> `UNDER_REVIEW` -> `ACKNOWLEDGED` -> `RESOLVED` | `DISMISSED`

Every transition executes through atomic RPC `transition_security_incident_atomic` (`PATCH /api/teacher/incidents/[incidentId]`):
1. Locks row `FOR UPDATE` and checks `auth_can_monitor_exam(exam_id)`.
2. Updates `exam_security_incidents.status` and records `resolution_summary` when resolved or dismissed.
3. Appends an immutable record to `public.incident_review_actions` (protected by `trg_incident_review_actions_immutable`) recording actor, previous/new status, and mandatory reviewer note (`>= 3` chars).
4. Records school audit telemetry in `monitoring_audit_events` and `audit_events`.

## 3. Fairness & Non-Mutation Guarantee

No trigger, RPC, service, or UI workflow connects `exam_security_incidents` to `exam_grades`, `manual_grading_entries`, `exam_submissions`, or attempt completion. Dismissing (`DISMISSED`) a false positive caused by lab Wi-Fi interruption leaves the student's submitted answers and score completely untouched.
