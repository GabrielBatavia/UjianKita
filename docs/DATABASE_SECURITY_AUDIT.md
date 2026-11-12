# Database Security Audit (Local PostgreSQL Migrations `000001`–`000010`)

This report documents the live PostgreSQL Row Level Security (RLS), role-based authorization, immutability trigger, and dependency audit performed against local Docker Supabase (`postgres:15.19.0.018`).

---

## 1. Schema, Policy & Immutability Verification

Verified across live PostgreSQL inspection and `pg_dump` / `pg_restore` schema parity checks:
- **Public Tables:** `48` tables with RLS enforced across tenant, question bank, exam lifecycle, attempt/answer/receipt, grading, and monitoring tables.
- **Public RLS Policies:** `100` active policies enforced at the PostgreSQL layer (`anon` and `authenticated` roles cannot read cross-school or unauthorized rows even with direct Supabase PostgREST queries).
- **Public Functions:** `52` PL/pgSQL helpers and transactional RPCs with explicit `SET search_path = public, auth` and `REVOKE ALL FROM PUBLIC` / explicit role grants.
- **Foreign Keys:** `158` foreign-key constraints plus Phase 1.5 same-school triggers (`trg_enforce_same_school_*`) blocking cross-tenant FK linking.

Verified tenant & role isolation invariants (tested live in `tests/integration/phase5-rls-and-cross-school.test.ts` and existing integration suites):
- Students in School A have zero RLS read access to School B rows, unpublished drafts, `question_answer_keys`, `exam_version_answer_keys`, `secure_browser_configs`, `exam_security_incidents`, `incident_review_actions`, or unreleased `exam_grades`.
- Teachers cannot read, modify, or grade exams/attempts outside their school or assigned subjects (`auth_can_manage_exam`, `auth_teacher_can_grade_attempt`).
- `audit_events`, `exam_publication_events`, `question_versions`, `exam_versions`, `exam_submissions`, `submission_receipts`, `grade_adjustments`, and `monitoring_audit_events` enforce immutability via triggers blocking `UPDATE`/`DELETE`.

---

## 2. Live Audit Findings Resolved in Migration `000010`

Live execution of all `describe.skipIf(!hasLiveSupabase)` suites surfaced three real PostgreSQL issues that were fixed in `supabase/migrations/20261112000010_phase5_security_and_rpc_hardening.sql`:

1. **Option Snapshot Key Normalization (`BUG-01`):** `start_or_resume_exam_attempt` previously expected camelCase keys in `options_snapshot` while `publish_exam_atomic` stored snake_case (`option_key`, `option_text`, `display_order`). Fixed in `000010` with camelCase fallback.
2. **Null-Guard Bypass on Monitoring RPCs (`BUG-02`):** `record_attempt_heartbeat_atomic` and `record_monitoring_events_batch_atomic` now explicitly check `auth_student_id()` for `NULL` before evaluating attempt ownership so non-student or unlinked tokens cannot satisfy permissive predicates.
3. **Proctor / Coordinator / Read-Only Auditor Separation (`BUG-03`):** Introduced `auth_can_write_exam_monitoring(target_exam_id)` alongside `auth_can_monitor_exam(target_exam_id)` so `auditor` users retain read-only visibility without incident review/override write permissions, while `proctor` and `exam_coordinator` users receive scoped write capabilities (`transition_security_incident_atomic`, `grant_attempt_browser_override_atomic`, `grant_student_exam_browser_override_atomic`) and scoped read policies (`students_select_authorized`, `exams_select_authorized`, `exam_attempts_staff_select`, `attempt_events_staff_select`, `audit_events_select_admin`).

---

## 3. Dependency Vulnerability Audit (`npm audit`)

Latest `npm audit` output: **`9 moderate severity vulnerabilities`** (`0` critical, `0` high, `0` low):
- `uuid <11.1.1` (`GHSA-w5hq-g745-h8pq`, moderate): transitive dependency of `exceljs >=3.5.0` (used only for teacher CSV/XLSX question import/template export; UjianKita does not invoke `uuid.v3`/`v5`/`v6` with user buffers). `npm audit fix --force` warns of a breaking downgrade to `exceljs@3.4.0`.
- `minimatch 7.0.0 - 11.0.0` (`GHSA-g3hv-75wg-m249`, moderate): transitive dev-only dependency via `@typescript-eslint/*` -> `typescript-eslint`.

No critical or high vulnerabilities were reported.
