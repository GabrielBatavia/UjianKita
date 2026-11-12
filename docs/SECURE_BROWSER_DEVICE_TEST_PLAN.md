# Secure Browser Physical Device Test Plan (ExamBro & Safe Exam Browser)

Before enabling `VERIFIED_SEB_REQUIRED` or enforcing locked exam-browser policies for an official school examination on Vercel/Supabase, complete the physical device checklist below on a staging/preview deployment using synthetic test accounts only.

---

## 1. Prerequisites

1. Deployment served strictly over HTTPS (e.g., trusted Vercel Preview or canonical Production domain) with valid TLS certificate.
2. Test exam configured by a synthetic teacher account (`exam_security_policies` verified):
   - **Pilot A (ExamBro / Mixed Mobile):** `browser_policy = "SECURE_BROWSER_RECOMMENDED"`, `exambro_enabled = true`.
   - **Pilot B (Strict SEB):** `browser_policy = "VERIFIED_SEB_REQUIRED"`, valid `.seb` `ConfigKeyHash` (64-hex SHA-256) saved in policy.
3. Synthetic student test credentials prepared and removed after completion.

---

## 2. Android ExamBro (`com.dekikurnia.exambro`) Checklist

1. **QR Code Deep Link & Entry:**
   - Open the exam instructions page (`/student/exams/[examId]`) on a projector/teacher browser or scan from the Student Exam Security Card.
   - Scan the ExamBro SVG QR code on at least two physical Android devices (recommended: Android 11+ and Android 13/14 devices).
   - Verify the target URL opens directly inside the ExamBro WebView without TLS warnings, broken CSP blocks, or infinite `/login` redirect loops.
2. **Authentication Behind Shared School Wi-Fi:**
   - Sign in concurrently with 5–10 synthetic student sessions on the same school Wi-Fi NAT public IP.
   - Confirm all logins succeed (`200 OK`, cookies `SameSite=Lax; Secure` persist across navigations).
3. **Kiosk Restrictions & Scoped Content Guards:**
   - Verify question prompt selection/copy guard does not block tapping radio options, checkboxes, or typing into `<textarea>` essay inputs.
   - Verify clicking Submit on `/review` works cleanly inside ExamBro WebView.
4. **Network Interruption & Re-Entry:**
   - Briefly toggle airplane mode while answering -> confirm UI shows pending/offline status honestly (never falsely showing saved) -> restore Wi-Fi -> confirm queued answers flush cleanly and server timer matches deadline.
5. **Incident & Proctor Override Path:**
   - Exit/background ExamBro to trigger focus-loss/heartbeat gap -> verify teacher monitoring dashboard displays neutral evidence events (not automatic cheating accusation) and test granting a staff exception/override for a legitimate device crash.

---

## 3. iOS / iPadOS / macOS / Windows Safe Exam Browser (SEB) Checklist

1. **SEB Config File Download & Launch:**
   - Download the generated `.seb` XML plist from `/api/student/exams/[examId]/seb-config` (or open via `sebs://`).
   - Confirm Safe Exam Browser opens the exam start URL cleanly.
2. **Cryptographic Key Verification (`ConfigKey` & `RequestHash`):**
   - Trigger verification via `/api/student/exams/[examId]/seb-verify`.
   - Verify both paths:
     - **HTTP Request Headers:** `X-SafeExamBrowser-ConfigKeyHash` and/or `X-SafeExamBrowser-RequestHash` match `SHA256(normalizedUrl + keyHex)` on the server.
     - **JS Callback (`SafeExamBrowser.security.updateKeys`):** When supported on SEB iOS/macOS/Windows, confirm client callback supplies valid keys and unlocks `VERIFIED_SEB_REQUIRED`.
3. **Negative / Spoof Test:**
   - Open the same `VERIFIED_SEB_REQUIRED` exam in regular Chrome/Safari with a forged `User-Agent: SEB/...` header.
   - Confirm server **rejects** access (`verified = false`) because `User-Agent` alone never grants verified trust without cryptographic key match.
4. **Staff Override Recovery:**
   - Grant a temporary exception via `/teacher/monitoring/[examId]` (`POST /api/teacher/attempts/[attemptId]/browser-override` or exam override) for a test student and verify audit log + student access recovery.
5. **Cleanup:**
   - Delete synthetic exam, attempts, and test user accounts once all checks pass.
