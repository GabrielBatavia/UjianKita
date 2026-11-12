# UjianKita Phase 4 — Official Safe Exam Browser (SEB) Integration

## 1. Cryptographic Specification Adherence

UjianKita implements Safe Exam Browser verification (`src/domain/monitoring/seb-verification.ts`) matching official `safeexambrowser.org` specifications:

1. **ConfigKey Generation (`computeSebConfigKeyFromPlistXml` / `computeSebConfigKeyFromObject`):**
   - Parses the `.seb` XML plist root `<dict>`
   - Removes `originatorVersion` if present
   - Recursively sorts all dictionary keys in ordinal lexicographical code-unit order
   - Serializes into compact whitespace-free JSON (`SEB-JSON`)
   - Computes lowercase 64-character SHA-256 hex digest (`ConfigKey`)
2. **Request Hash Verification (`computeSebRequestHash` / `verifySebKeyProof`):**
   - Strips `#fragment` (including `#`) from the absolute URL (`normalizeSebUrl`)
   - Verifies URL matches the expected application origin and `/student/exams/${examId}` or `/api/student/exams/${examId}` scope (`isAllowedSebProofUrl`)
   - Concatenates `normalizedUrl + keyHex` (**URL first**, UTF-8) and hashes with SHA-256
   - Compares against `ConfigKeyHash` and optional `BrowserExamKeyHash` using constant-time `crypto.timingSafeEqual` (`constantTimeHexEquals`)

## 2. iOS & Modern WKWebView Support

Modern Safe Exam Browser on iOS (`WKWebView`) cannot reliably attach `X-SafeExamBrowser-ConfigKeyHash` HTTP headers on all requests; instead SEB injects the JavaScript API `window.SafeExamBrowser.security.updateKeys(callback)`.

UjianKita handles both seamlessly:
- **Pre-Exam / Instructions (`StudentExamInstructions`):** Automatically detects `window.SafeExamBrowser.security.updateKeys`, sends hashes to `POST /api/student/exams/[examId]/seb-verify`, and includes proof fields in `POST /api/student/exams/[examId]/start`. Once validated, the attempt records `browser_trust_level = 'verified_seb_js_key'` and `seb_verified_at_utc`.
- **Header-Supporting SEB Desktop:** Also verifies `X-SafeExamBrowser-ConfigKeyHash` and `X-SafeExamBrowser-RequestHash` headers (`verified_seb_header_and_key`).
- **One-Click Config & Launch Links:** Teachers can auto-generate `.seb` plist profiles (`buildSebExamProfile`), students download via `GET /api/student/exams/[examId]/seb-config` (`application/seb`), and launch via `sebs://` deep links (`buildSebLaunchLinks`).

## 3. Emergency Proctor Override Workflow

If a student's iPad or desktop SEB client experiences a hardware/network fault under `VERIFIED_SEB_REQUIRED`:
1. A teacher, proctor, or admin opens `/teacher/monitoring/[examId]` (or `/admin/monitoring/[examId]`).
2. Grants an audited override (`POST /api/teacher/attempts/[attemptId]/browser-override` or `POST /api/teacher/monitoring/[examId]/override`) requiring a minimum 5-character operational reason and valid duration (default 240 min).
3. Both `exam_student_browser_overrides` (supporting pre-start students) and `exam_attempts` receive audited `staff_override` permission logged to `monitoring_audit_events` and `audit_events`.
