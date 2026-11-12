# Production Cloud End-to-End Verification Results

This document contains the step-by-step verification evidence and execution logs for the complete CBT examination workflow on the live production environment of **UjianKita** at `https://ujiankita-three.vercel.app`.

---

## 1. Test Metadata

- **Test Execution Timestamp:** 2026-11-12T17:27:08Z
- **Target URL:** `https://ujiankita-three.vercel.app`
- **Target Database:** `https://hqoxqmmkysnnneqlepuj.supabase.co`
- **Execution Engine:** Node.js 25.2.1 + Playwright Chromium (Automated E2E script)
- **Synthetic Test Run Tag:** `7199f20e`

---

## 2. Stage-by-Stage Verification Evidence

### Stage 1: Infrastructure & Health Telemetry
- **Endpoint:** `GET /api/health`
- **HTTP Status:** `200 OK`
- **Response Payload:** `{"status":"healthy","service":"ujiankita-web","phase":"phase-6","supabase":{"configured":true,"serviceRoleConfigured":true,"reachable":true,"error":null}}`
- **Latency (5 warm samples):** `262 ms`, `260 ms`, `216 ms`, `255 ms`, `237 ms` (Mean: `246 ms`)

### Stage 2: School Administration & Provisioning
- **Admin Authentication:** Authenticated via `POST /api/auth/login` as school admin.
- **Academic Year:** Created `2026/2027` (Semester Ganjil) via `POST /api/admin/academic-years`.
- **Subject:** Created `Informatika` (INF) via `POST /api/admin/subjects`.
- **Class:** Created `X-1` via `POST /api/admin/classes`.
- **Staff Provisioning:** Provisioned teacher `Guru Uji 7199f20e` (`guru-7199f20e@ujiankita-staging.local`) via `POST /api/admin/teachers`.
- **Student Provisioning:** Provisioned student `Siswa Uji 7199f20e` (`siswa-7199f20e@ujiankita-staging.local`, NIS: `NIS7199f20e`) in class `X-1` via `POST /api/admin/students`.
- **Teacher Assignment:** Linked teacher to Subject + Class + Academic Year via `POST /api/admin/teachers/assignments`.

### Stage 3: Teacher Question Bank & Examination Publishing
- **Teacher Authentication:** Authenticated via `POST /api/auth/login` as teacher.
- **Question 1 (Single Choice, 50 pts):** Created via `POST /api/teacher/questions` with options A, B (correct), C.
- **Question 2 (Essay, 50 pts):** Created via `POST /api/teacher/questions` with manual rubric notes.
- **Exam Draft:** Created draft exam `Ujian Verifikasi Cloud 7199f20e` via `POST /api/teacher/exams`.
- **Draft Question Assembly:** Attached both questions via `PUT /api/teacher/exams/[id]/questions` (`version_lock` updated).
- **Scheduling:** Assigned to class `X-1` with 45-minute duration via `PUT /api/teacher/exams/[id]/schedule`.
- **Readiness Validation:** Validated readiness checklist via `POST /api/teacher/exams/[id]/validate` (passed).
- **Publish Snapshot:** Executed atomic publish via `POST /api/teacher/exams/[id]/publish`. Produced immutable `exam_versions` and isolated `exam_version_answer_keys`.

### Stage 4: Cross-School Access Isolation
- **Admin B Authentication:** Authenticated as Administrator of an isolated second school (`SMA Staging B 7199f20e`).
- **Exam Access Leak Test:** Queried `GET /api/admin/exams/[examId]` (School A's exam) -> **Returned HTTP `404` / `403`**.
- **Student List Leak Test:** Queried `GET /api/admin/students` -> **Confirmed 0 student records from School A leaked**.

### Stage 5: Playwright Headless Browser UI
- **Landing Page:** Headless Chromium navigated to `https://ujiankita-three.vercel.app/` -> Verified Bahasa Indonesia branding, zero outdated placeholder strings.
- **Protected Route Interception:** Navigated directly to `/student` -> Clean redirect to `/login?next=%2Fstudent`.
- **Form Login:** Filled email and password, clicked submit -> Successfully redirected to `/student`.
- **Browser Errors:** Inspected browser console -> **0 uncaught exceptions, 0 hydration errors**.

### Stage 6: Student Examination Lifecycle & Anti-Cheat Boundaries
- **Answer Key Protection:** Authenticated student attempted direct Supabase RLS query on `question_answer_keys` and `exam_version_answer_keys` -> **0 rows returned**.
- **Shared Wi-Fi NAT Burst:** Fired 4 concurrent login requests from the same IP -> **All 4 returned HTTP `200 OK`**.
- **Exam Start:** Called `POST /api/student/exams/[examId]/start` -> Created attempt. Confirmed start response payload contained **zero** answer key fields.
- **Workspace Fetch:** Called `GET /api/student/attempts/[attemptId]` -> Received 2 realizable questions.
- **Heartbeat:** Sent `POST /api/student/attempts/[attemptId]/heartbeat` -> Returned `HTTP 200`.
- **Telemetry Event:** Sent batched event `EXAM_PAGE_VISIBLE` via `POST /api/student/attempts/[attemptId]/events` -> Returned `HTTP 201`.
- **Autosave Single Choice:** Saved option `B` via `PUT /api/student/attempts/[attemptId]/answers` -> Returned `HTTP 200` (`COMMITTED`).
- **Autosave Essay:** Saved text response via `PUT /api/student/attempts/[attemptId]/answers` -> Returned `HTTP 200` (`COMMITTED`).
- **Submission:** Finalized attempt via `POST /api/student/attempts/[attemptId]/submit` -> Returned `HTTP 200`.
- **Receipt:** Fetched immutable `SubmissionReceipt` via `GET /api/student/attempts/[attemptId]/receipt` -> Returned `HTTP 200`.

### Stage 7: Monitoring, Essay Grading, Result Release & Verification
- **Teacher Monitoring Control Center:** Queried `GET /api/teacher/monitoring/[examId]` -> Successfully displayed the active/submitted student attempt.
- **Manual Essay Grading:** Teacher graded essay via `PUT /api/teacher/attempts/[attemptId]/grade` with score `40` and feedback -> Returned `HTTP 200`. Total score computed: 50 (objective) + 40 (essay) = **90/100**.
- **Result Release:** Teacher released scores via `POST /api/teacher/exams/[examId]/release` (`action: "release"`).
- **Student Results Access:** Student queried `GET /api/student/results` -> **Score `90` returned and visible**.
- **Direct PostgreSQL Verification:**
  - `exam_attempts.status`: `"SUBMITTED"`
  - `exam_grades.total_score`: `90`
  - `exam_grades.release_status`: `"RELEASED"`
