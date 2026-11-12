# UjianKita Phase 4 — Privacy Notice, Access Isolation & Data Retention

## 1. Transparent Student Privacy Disclosure

Every exam instruction page displays the policy's Bahasa Indonesia privacy notice (`DEFAULT_PRIVACY_NOTICE_ID` or teacher-customized policy notice):
- Discloses precisely what is logged: connectivity heartbeats, tab visibility/reload events, and browser environment signals.
- Explicitly guarantees what is **NOT** collected: no webcam, microphone, screen recording, background apps, or clipboard monitoring outside the exam page.
- Guarantees monitoring signals never alter grades or fail students automatically.

## 2. Least-Privilege Access Isolation

Implemented in migration `20261112000009_phase4_rls_and_monitoring_rpcs.sql`:
- **Student Isolation:** Students have **zero SELECT permissions** on `exam_security_policies` (preventing disclosure of `seb_config_key_hash` and `seb_browser_exam_key_hash`), `secure_browser_configs`, `exam_security_incidents`, `incident_review_actions`, `monitoring_audit_events`, and `exam_student_browser_overrides`. Students access only safe launch metadata via `GET /api/student/exams/[examId]/policy`.
- **`attempt_events` Hardening:** Students can read only their own `server_confirmed` lifecycle timestamps (`EXAM_SESSION_STARTED`, `EXAM_SESSION_SUBMITTED`, `EXAM_SESSION_EXPIRED`) and direct inserts are limited to `client_reported` payloads under 2048 bytes.
- **CSV Export Neutralization:** `sanitizeCsvCell` prefixes leading `=`, `+`, `-`, `@`, `\t`, `\r` characters with `'` to neutralize Excel/Sheets formula injection, and every report embeds `SECURITY_REPORT_DISCLAIMER_ID`.

## 3. Admin-Only Data Retention Policy

Administrators can simulate (`dryRun: true`) and execute (`dryRun: false`) retention cleanup via `/admin/monitoring` (`POST /api/admin/monitoring/retention` -> `purge_expired_monitoring_records_atomic`):
- Enforces minimum retention floor (`daysToKeep >= 30` days).
- Removes only finalized attempts' historical `attempt_events` (via transaction-scoped `ujk.allow_retention_purge = 'on'`) and closed (`RESOLVED` / `DISMISSED`) incidents older than cutoff.
- Never removes `exam_submissions`, `submission_receipts`, or `exam_grades`, and logs every purge into `monitoring_audit_events` and `audit_events`.
