# Security Model

UjianKita applies defense-in-depth aligned with OWASP ASVS principles and the Technical Blueprint threat model.

---

## 1. Authentication & Session Integrity

- **Supabase SSR verification:** `src/proxy.ts` and `src/repositories/auth-repository.ts` always verify sessions using `supabase.auth.getUser()`, never `getSession()` (which only inspects raw cookies).
- **No self-registration:** `enable_signup` is disabled; administrators provision staff and student accounts.
- **Safe authentication errors:** Login and password-reset endpoints return generic, non-enumerating messages in Bahasa Indonesia (`src/lib/security.ts`).
- **Open-redirect defense:** `sanitizeInternalRedirectPath()` rejects external URLs, protocol-relative URLs (`//`), and backslash escapes in `?next=` parameters.
- **Rate limiting:** Login, password recovery, and administrative write routes apply sliding-window throttling (`src/lib/rate-limit.ts`) returning `429` with `Retry-After`. *(Note: Phase 1 uses per-instance in-memory buckets; Phase 2 should introduce centralized rate limiting for multi-lambda global consistency.)*

---

## 2. Authorization & Anti-Escalation

- **Server-authoritative roles:** Roles are never read from client request payloads, URL paths, local storage, or mutable JWT `user_metadata`. Every request resolves `user_profiles` + `user_roles` + `roles` from PostgreSQL.
- **Tenant & ownership boundaries:**
  - `schools`, `academic_years`, `classes`, `subjects`, `students`, `teachers`, `audit_events`, `question_banks`, `questions`, `question_versions`, `question_options`, `question_answer_keys`, `exams`, `exam_versions`, `exam_version_questions`, and `exam_version_answer_keys` are strictly scoped by `school_id`.
  - Phase 1.5 database triggers (`trg_enforce_same_school_classes`, `trg_enforce_same_school_enrollments`, `trg_enforce_same_school_teacher_assignments`) block cross-school foreign-key linking even under elevated clients.
  - Teachers can access and edit bank questions and draft exams **only** for subjects actively assigned to them (`auth_teacher_teaches_subject`, `auth_can_access_subject_content`, `auth_can_manage_exam`) and assign/schedule exams **only** for classes they teach or homeroom.
  - Students can read **only** their own `students` row and their own active `class_enrollments`, and have **zero** RLS read policies or API routes accessing `question_answer_keys`, `exam_version_answer_keys`, question banks, or exam drafts.
  - Only `admin` users of the same school can mutate school records, exercise `exams.oversight`, or read `audit_events`.
- **Dual enforcement:** Authorization is checked both in Next.js server services (`src/policies/authorization.ts`) and natively inside PostgreSQL RLS policies.

---

## 3. Secret Management & HTTP Headers

- `SUPABASE_SERVICE_ROLE_KEY` is guarded in `src/lib/env.ts` (`typeof window !== "undefined"` throws) and `src/lib/supabase/admin.ts`, and is never prefixed with `NEXT_PUBLIC_`.
- `.env*` local secret files are excluded in `.gitignore`.
- `next.config.ts` sets baseline security headers across all routes:
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

## 5. Planned Hardening Before Official High-Stakes Exams (Phase 3–4)

- Enable MFA (TOTP) enforcement for Administrator, Exam Coordinator, and Teacher accounts.
- Upgrade rate limiting to a distributed store (Supabase or Upstash) ahead of ~100 simultaneous login bursts.
- Enforce live RLS policies and isolated attempt/submission RPCs once Phase 3 delivery tables (`exam_attempts`, `student_answers`, `submission_receipts`) are deployed.
- Conduct an independent OWASP ASVS verification pass prior to high-stakes launch.
