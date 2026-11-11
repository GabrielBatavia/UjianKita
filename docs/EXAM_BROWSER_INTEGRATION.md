# ExamBro (Android) & Safe Exam Browser (iOS) Integration Research

This document captures Phase 1 technical research, verified capabilities, security limitations, interface contracts, and open compatibility questions for UjianKita's intended student examination browsers:

- **Android:** ExamBro (specifically evaluating exact Play Store products, e.g., `com.dekikurnia.exambro` and competing ExamBro variants)
- **iPhone / iPad:** Safe Exam Browser (SEB) for iOS

---

## 1. Fundamental Browser Security Reality

UjianKita's architecture strictly enforces the following boundaries:

1. **A website cannot prevent operating-system screenshots or screen recording.** Only native OS flags (such as Android `FLAG_SECURE` controlled by a native wrapper app like ExamBro, or iOS Assessment/Single-App lockdown modes managed by SEB/MDM) can restrict capture—and even those depend on OS version and device manufacturer behavior.
2. **A website cannot prevent second-device photography.** Technical controls must always be paired with physical invigilation and randomized question/option ordering.
3. **A User-Agent string or client JavaScript flag is NOT cryptographic proof of authenticity.** Any client can spoof `User-Agent` headers or inject fake `window` globals.
4. **Monitoring is decoupled from answer persistence.** Even if browser telemetry or visibility events fail to send (e.g., force-quit or poor network), confirmed answers in PostgreSQL must remain completely safe.

---

## 2. iOS: Safe Exam Browser (SEB) Analysis

### Mechanism & Current iOS WebKit Limitations
- Modern SEB for iOS (`3.x+`) runs on Apple's **`WKWebView`**.
- Because `WKWebView` does not reliably allow injecting custom HTTP headers (`X-SafeExamBrowser-RequestHash`, `X-SafeExamBrowser-ConfigKeyHash`) on arbitrary outgoing requests, older HTTP-header-only verification methods (like legacy Moodle/custom header checks) are **unreliable on iOS**.
- Instead, SEB provides the **SEB JavaScript API**, exposing `window.SafeExamBrowser.security.updateKeys(callback)` asynchronously inside the loaded page.
- `updateKeys` computes SHA-256 hashes bound to the current page URL alongside the active **ConfigKey (CK)** and **BrowserExamKey (BEK)** defined in the `.seb` assessment configuration file.

### Planned UjianKita Integration Flow (Phase 2/3)
1. **Configuration Distribution:** School exam coordinators generate/publish an exam-specific `.seb` configuration pointing exclusively to the allowed UjianKita exam origin (`allowedHosts`) and restricting navigation/dialogs.
2. **Client Verification Call:** Before starting or resuming a high-stakes attempt in SEB mode, the UjianKita frontend invokes `SafeExamBrowser.security.updateKeys(...)` and submits `(configKeyHash, browserExamKeyHash, currentUrl)` to the backend.
3. **Server Verification:** The UjianKita server computes `SHA256(exactUrl + expectedConfigKey)` (and BrowserExamKey where applicable) and verifies against the submitted hash before issuing/unlocking the attempt session token.
4. **Fail-Closed Policy:** For examinations marked `require_exam_browser_in_high_stakes = true`, failed or absent SEB verification denies access rather than silently allowing standard Safari.

---

## 3. Android: ExamBro Ecosystem Analysis

### Fragmentation Warning
Multiple unrelated Android apps on Google Play share the name **"ExamBro"** / **"Exambro"** (for example `com.dekikurnia.exambro` and others). Their capabilities, WebView engines, Android API targets, ad-supported behaviors, and exit mechanisms differ substantially.

### Observed Capabilities (Representative Listing: `com.dekikurnia.exambro`)
- Android WebView container with URL/QR exam launch support.
- App-level controls commonly include: `FLAG_SECURE` screenshot/screen-recording blocking, split-screen/floating-window blocking, notification suppression, headset/Bluetooth audio checks, and exit password / alarm triggers on escape attempts.
- **Crucial Limitation:** Standard Google Play ExamBro builds typically **do not implement a cryptographic ConfigKey/BrowserExamKey protocol** comparable to SEB. Some rely only on a customizable `User-Agent` token or QR-encoded launch URLs, which can be spoofed by a knowledgeable user outside a supervised classroom.

### Planned UjianKita Integration Contract (Prepared in `src/domain/exams/contracts.ts`)
Our domain interface explicitly separates trust levels via `VerificationTrustLevel`:
- `'protocol_verified'` — reserved for cryptographically verifiable mechanisms (SEB ConfigKey/BEK over HTTPS).
- `'unverified_client_hint'` — User-Agent or launcher-token heuristics (logged for proctor visibility and combined with classroom supervision, **never** falsely reported as tamper-proof authentication).
- `'none'` — standard mobile browser (allowed only for practice/low-stakes mode if school policy permits).

---

## 4. Open Compatibility Questions to Resolve Before Phase 3

1. **Exact Android ExamBro Selection:** Which specific Google Play package ID and minimum version will the school mandate? Does it inject ads, require paid licensing to remove ads/configure custom User-Agents, or interfere with WebView `localStorage`/`IndexedDB`?
2. **Minimum OS Matrix:** What are the oldest Android (e.g., Android 10/11) and iOS (e.g., iOS 15/16) versions owned by students?
3. **WebView Storage Persistence:** Does the chosen ExamBro WebView preserve `localStorage` and `IndexedDB` across an accidental back-press or app reload (affecting offline pending-answer recovery), or does it wipe WebView storage on exit?
4. **Input & Media Compatibility:** Do Indonesian virtual keyboards (Gboard, Samsung Keyboard), file/image rendering, and LaTeX mathematical expressions render cleanly inside both ExamBro's WebView and SEB's `WKWebView` without scrolling glitches or obscured inputs?
5. **Network & Captive Portal Behavior:** How do ExamBro and SEB behave when school Wi-Fi drops briefly and reconnects mid-exam?

---

## 5. Planned Real-Device Acceptance Matrix (Stage 3 Gate)

Before any official exam relies on ExamBro or SEB, every target device class must pass manual acceptance testing across:
1. **Launch & Exit:** Correct URL launch via link/QR, allowed domains, exit confirmation password.
2. **Screen Capture:** Verified screenshot & screen-recording behavior documented per exact device model + OS version.
3. **App Switching & Overlays:** Incoming WhatsApp/notification banners, split-screen, floating windows, and incoming phone calls.
4. **Exam UI & Accessibility:** Soft keyboard overlap on text/numeric answers, image scaling, zoom/font scaling, touch target ergonomics.
5. **Network Drop & Reload:** Airplane mode toggle mid-save -> honest `"Koneksi terputus"` indicator -> reconnect -> confirmed DB reconciliation.

---

## References
- Safe Exam Browser iOS User Manual: https://safeexambrowser.org/ios/ios_usermanual_en.html
- Safe Exam Browser Developer Integration: https://safeexambrowser.org/developer/seb-integration.html
- Safe Exam Browser iOS Release Notes & JS API: https://safeexambrowser.org/ios/ios_release_notes_en.html
- Google Play Representative ExamBro Listing: https://play.google.com/store/apps/details?id=com.dekikurnia.exambro
- MDN `visibilitychange` & `navigator.sendBeacon`: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
