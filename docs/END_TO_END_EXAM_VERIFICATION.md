# End-to-End Examination Workflow Verification

UjianKita verifies both unauthenticated security boundaries and **full authenticated end-to-end examination workflows** against a live local Next.js production server (`npx next start -p 3100`) backed by live local Docker Supabase.

---

## 1. Playwright Suite Coverage (`tests/e2e/`)

| Spec File | Scenarios Covered | Target Browsers (Local Windows) |
|---|---|---|
| `foundation.spec.ts` | Bahasa Indonesia landing copy, CSP/security headers, `GET /api/health`, fail-closed redirects to `/login`, WCAG 2.2 AA on public auth routes, 404 recovery | `desktop-chromium`, `mobile-android` (`Pixel 7`) |
| `phase3-exam-flow.spec.ts` | Non-cacheable fail-closed responses across student/grading APIs, unauthenticated portal redirects, `390x844` mobile ExamBro-sized viewport check & Axe scan | `desktop-chromium`, `mobile-android` |
| `phase4-monitoring.spec.ts` | Monitoring portal redirect guards, unauthenticated `401/403/503` checks across monitoring/SEB endpoints, responsive login/landing checks | `desktop-chromium`, `mobile-android` |
| `phase5-authenticated-workflows.spec.ts` | Complete live authenticated flow (details below) | `desktop-chromium`, `mobile-android` |

> **Platform Constraint (`mobile-iphone` WebKit on Windows):** `playwright.config.ts` defines `mobile-iphone` (`iPhone 13`, WebKit). On this Windows host, WebKit fails at launch due to missing host DLL dependencies (`exitCode=3221225501`, `STATUS_DLL_NOT_FOUND`). `mobile-iphone` executes on Linux/Ubuntu CI runners (`.github/workflows/ci.yml`), while Windows verification covers `desktop-chromium` and `mobile-android` (`24` tests total).

---

## 2. Authenticated End-to-End Flow (`phase5-authenticated-workflows.spec.ts`)

Using a freshly provisioned isolated synthetic school (`single_choice` 40 pts + `essay` 60 pts published exam, real student & teacher Supabase Auth users):

1. **Student Real UI Login:** Logs in via `/login` (`#login-email`, `#login-password`) and navigates to `/student/exams/[examId]/instructions`.
2. **Exam Start & Viewport Hygiene:** Confirms `"Mulai Ujian Sekarang"` stays disabled until the rules acknowledgement checkbox is checked, starts the attempt (`POST /start`), and verifies zero horizontal overflow (`scrollWidth - clientWidth <= 2`).
3. **Objective Answer Persistence & Browser Reload Resume:** Selects option `"A"` (`"SQL"`), waits for PostgreSQL-acknowledged `"Tersimpan"`, executes `page.reload({ waitUntil: "domcontentloaded" })`, and asserts radio `"A"` remains checked from server state.
4. **Essay Entry, Review & Atomic Submission:** Advances via `"Berikutnya"`, enters essay response, blurs to trigger debounce flush (`"Tersimpan"`), navigates to `/student/attempts/[attemptId]/review`, submits final attempt, and reaches `/student/attempts/[attemptId]/receipt`.
5. **Receipt WCAG 2.2 AA Check:** Runs `@axe-core/playwright` on the authenticated submission receipt page (`0` violations).
6. **Teacher Grading & Score Release:** Logs in as teacher via UI on `/teacher/exams/[examId]/grading`, assigns essay score `55` + feedback (total `95/100`), saves, and releases results (`release_status = 'RELEASED'`).
7. **Live Monitoring Control Center:** Navigates to `/teacher/monitoring/[examId]` and verifies student supervision row & counters are visible to the teacher.
8. **Student Result Verification:** Logs back in as the student on `/student/results` and verifies published score **`95`** is visible.
9. **Zero Runtime Errors:** Asserts `pageErrors === []` and `consoleErrors === []` across all navigations.

---

## 3. Hydration Defect Fixed During E2E Verification

During initial production E2E testing on `/student/attempts/[attemptId]`, Chromium reported minified React error `#418` (`HTML` mismatch). Running `next dev` revealed the root cause in `src/components/features/student/exam-player-client.tsx`:

- Node.js 22 provides `globalThis.navigator`, where `navigator.onLine` is `undefined`.
- Evaluating `typeof navigator === "undefined" ? true : navigator.onLine` during SSR rendered `<WifiOff />` and `"Terputus"` while the browser hydrated `<Wifi />` and `"Online"`.
- Fixing initial `isOnline` state to `true` and synchronizing `navigator.onLine` asynchronously inside `useEffect` eliminated React `#418` completely (`24/24` Playwright tests passing with `0` `pageerror`s and `0` `console.error`s).
