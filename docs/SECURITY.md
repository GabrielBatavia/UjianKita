# Security Model

UjianKita applies defense-in-depth aligned with OWASP ASVS principles and the Technical Blueprint threat model.

---

## 1. Authentication & Session Integrity

- **Supabase SSR verification:** `src/proxy.ts` and `src/repositories/auth-repository.ts` always verify sessions using `supabase.auth.getUser()`, never `getSession()` (which only inspects raw cookies).
- **No self-registration:** `enable_signup` is disabled; administrators provision staff and student accounts.
- **Safe authentication errors:** Login and password-reset endpoints return generic, non-enumerating messages in Bahasa Indonesia (`src/lib/security.ts`).
- **Open-redirect defense:** `sanitizeInternalRedirectPath()` rejects external URLs, protocol-relative URLs (`//`), and backslash escapes in `?next=` parameters.
- **Rate limiting:** Login, password recovery, administrative mutations, and student exam endpoints apply sliding-window throttling (`src/lib/rate-limit.ts`) returning `429` with `Retry-After`. Student and teacher grading APIs use per-user buckets (`enforceActorRateLimit()` in `src/lib/api-helpers.ts`) so ~100 NAT students sharing a school Wi-Fi IP do not exhaust each other's quotas. In Phase 6, `POST /api/auth/login` was upgraded to PostgreSQL-backed distributed rate limiting (`000011`), enforcing shared IP burst and failed-login limits (`LOGIN_IP_TOTAL_BURST_LIMIT = 300`, `LOGIN_IP_FAILURE_LIMIT = 25`, `LOGIN_EMAIL_BURST_LIMIT = 20`, `LOGIN_EMAIL_FAILURE_LIMIT = 8`) to allow simultaneous school Wi-Fi logins while throttling brute-force attempts across all serverless workers.

---

## 2. Authorization & Anti-Escalation

- **Server-authoritative roles:** Roles are never read from client request payloads, URL paths, local storage, or mutable JWT `user_metadata`. Every request resolves `user_profiles` + `user_roles` + `roles` from PostgreSQL.
- **Tenant & ownership boundaries:**
  - `schools`, `academic_years`, `classes`, `subjects`, `students`, `teachers`, `audit_events`, `question_banks`, `questions`, `question_versions`, `question_options`, `question_answer_keys`, `exams`, `exam_versions`, `exam_version_questions`, and `exam_version_answer_keys` are strictly scoped by `school_id`.
  - Phase 1.5 database triggers (`trg_enforce_same_school_classes`, `trg_enforce_same_school_enrollments`, `trg_enforce_same_school_teacher_assignments`) block cross-school foreign-key linking even under elevated clients.
  - Teachers can access, edit, and grade bank questions, draft exams, and student attempts **only** for subjects actively assigned to them (`auth_teacher_teaches_subject`, `auth_can_access_subject_content`, `auth_can_manage_exam`, `auth_teacher_can_grade_attempt`) and assign/schedule exams **only** for classes they teach or homeroom. Monitoring permissions (`monitoring.read`, `monitoring.incidents.write`, `monitoring.policies.write`, `monitoring.reports.export`) are similarly scoped per exam/school across `teacher`, `exam_coordinator`, `proctor`, and `auditor` (`monitoring.read` / `monitoring.reports.export`).
  - Students can read **only** their own `students` row, their own active `class_enrollments`, `PUBLISHED`/`CLOSED` assigned exams (`auth_student_can_access_exam`), their own `exam_attempts`/`attempt_question_assignments`/`student_answers`/`submission_receipts`, and `exam_grades` explicitly marked `release_status = 'RELEASED'`. Students have **zero** RLS read policies or API routes accessing `question_answer_keys`, `exam_version_answer_keys`, `exam_version_questions`, explanations, grading rubrics, `secure_browser_configs` (`config_key_hash`, `browser_exam_key_hashes`, raw `.seb` XML), `exam_security_incidents`, `incident_review_actions`, or exam drafts.
  - Phase 4 tightens `attempt_events` RLS so students cannot directly insert fabricated server-class event types (`event_source` is enforced strictly server-side inside `record_monitoring_events_batch_atomic` with <=2KB metadata caps and batch size <=25).
  - Only `admin` users of the same school can mutate school records, exercise `exams.oversight` / `monitoring.oversight`, cancel active student attempts (`cancel_exam_attempt_by_admin`), run monitoring retention cleanup (`purge_old_monitoring_telemetry`), or read `audit_events`.
- **Dual enforcement:** Authorization is checked both in Next.js server services (`src/policies/authorization.ts`) and natively inside PostgreSQL RLS policies.

---

## 3. Secret Management & HTTP Headers

- `SUPABASE_SERVICE_ROLE_KEY` is guarded in `src/lib/env.ts` (`typeof window !== "undefined"` throws) and `src/lib/supabase/admin.ts`, and is never prefixed with `NEXT_PUBLIC_`.
- `.env*` local secret files are excluded in `.gitignore`.
- `next.config.ts` sets baseline security headers across all routes (and Phase 3 student/grading API handlers also emit `Cache-Control: no-store, no-cache, must-revalidate, private` via `noStoreJson()`):
  - `Content-Security-Policy` (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`)
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
  - `Strict-Transport-Security` (in production)

---

## 4. Audit Logging, Snapshot Immutability & Content Safety

- **Immutable Audit & Publication Logs:** Sensitive actions across auth, school administration, Question Bank authoring/imports/archiving, and Exam configuration/publishing/revisions/oversight are written to `audit_events` (`trg_audit_events_immutable`) and `exam_publication_events` (`trg_exam_publication_events_immutable`), preventing `UPDATE` and `DELETE`.
- **Isolated Answer Keys & Safe Preview Projections:**
  - `question_answer_keys` and `exam_version_answer_keys` are physically separated from display options (`question_options` and `exam_version_questions.options_snapshot`).
  - `buildStudentSafeExamPreview()` never queries `exam_version_answer_keys` or `question_answer_keys` and omits explanations, scoring policies, and grading rubrics from `StudentExamPreviewPayload`.
- **XSS-Safe Rendering (`src/lib/question-content.ts`):** Question stems, options, explanations, and rubrics escape all raw HTML outside `$...$` / `$$...$$` math delimiters and invoke `katex.renderToString` with `trust: false`.
- **Spreadsheet Import Hardening (`src/domain/exams/import-parser.ts`):** Rejects uploads exceeding 2 MB or 500 rows, rejects `.xlsx` formula cells, and rejects spreadsheet formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).

---

## 5. Phase 4 Security Monitoring, SEB Cryptographic Proof & Privacy Controls

- **Cryptographic SEB Proof (`VERIFIED_SEB_REQUIRED`):** SEB ConfigKey (`SEB-JSON` canonicalization + SHA-256) and per-request Request Hash (`SHA-256(normalizedUrl + keyHex)`) verification (`src/domain/monitoring/seb-verification.ts`) uses `crypto.timingSafeEqual` on the server; spoofable `User-Agent` strings never unlock a `VERIFIED_SEB_REQUIRED` exam or attempt workspace.
- **Honest ExamBro Client Hints:** Android ExamBro detection is explicitly typed and surfaced as `unverified_client_hint` (`src/domain/monitoring/exambro-compat.ts`) because HTTP headers / JS hints from Android WebViews cannot establish hardware attestation without an official vendor signature/token.
- **Emergency Bypass Governance:** Staff overrides (`exam_student_browser_overrides`) require explicit `monitoring.incidents.write` authorization, a justification note, bounded expiry (`durationMinutes`), and immutable audit logging.
- **Data Minimization & Non-Accusatory Workflow:** Client telemetry batches are capped at 25 events with metadata `<= 2 KB` (`batchedMonitoringEventsSchema`), students receive clear Bahasa Indonesia privacy notices before starting, incidents never modify `exam_grades`, CSV monitoring reports neutralize spreadsheet formula prefixes, and Admins can execute dry-run / permanent telemetry retention purges (`purge_expired_monitoring_records_atomic`).

---

## 6. Phase 5 Verification Summary & Remaining Hardening Before High-Stakes Launch

- **Completed in Phase 5 (Local PostgreSQL):** Verified all 10 migrations (`000001`–`000010`), patched `options_snapshot` randomization alignment (`start_or_resume_exam_attempt`), `auth_student_id() IS NULL` ownership checks (`record_attempt_heartbeat_atomic`, `record_monitoring_events_batch_atomic`), and read-only `auditor` vs `proctor`/`exam_coordinator` write separation (`auth_can_write_exam_monitoring`) in migration `000010`; see `docs/DATABASE_SECURITY_AUDIT.md`.
- **Remaining before official high-stakes exams:**
  - Enable MFA (TOTP) enforcement for Administrator, Exam Coordinator, and Teacher accounts.
  - Upgrade `src/lib/rate-limit.ts` to a distributed store (e.g., Upstash Redis) ahead of multi-instance scaling and size/stagger login IP budgets for shared school Wi-Fi NAT gateways.
  - Validate real-device ExamBro Android & SEB iOS ConfigKey / BrowserExamKey handshake flows on physical hardware before enforcing lockdown-only exams.
  - Complete external cloud Supabase/Vercel provisioning (including managed PITR backups) and independent penetration testing ahead of live school rollout.
