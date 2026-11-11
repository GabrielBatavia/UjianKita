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
  - `schools`, `academic_years`, `classes`, `subjects`, `students`, `teachers`, and `audit_events` are strictly scoped by `school_id`.
  - Students can read **only** their own `students` row and their own active `class_enrollments`.
  - Teachers can read students **only** inside classes they actively teach or homeroom.
  - Only `admin` users of the same school can mutate school records or read `audit_events`.
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

## 4. Audit Logging

- Sensitive actions (`auth.login_success`, `auth.logout`, student/teacher creation and updates, assignments, class/subject updates, and school settings updates) are written to `audit_events`.
- `trg_audit_events_immutable` prevents `UPDATE` and `DELETE` operations on `audit_events` at the PostgreSQL trigger level.

---

## 5. Planned Hardening Before Phase 2/3 Official Exams

- Enable MFA (TOTP) enforcement for Administrator, Exam Coordinator, and Teacher accounts.
- Upgrade rate limiting to a distributed store (Supabase or Upstash) ahead of ~100 simultaneous login bursts.
- Enforce isolated RLS and API projections so `answer_keys` rows are never queryable by student tokens.
- Conduct an independent OWASP ASVS verification pass prior to high-stakes launch.
