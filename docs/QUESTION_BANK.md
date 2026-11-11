# Question Bank Module (Phase 2)

The UjianKita Question Bank module provides school-isolated, subject-scoped, versioned question authoring and bulk spreadsheet ingestion for teachers and school administrators.

---

## 1. Supported Question Types & Domain Validation

Implemented in `src/domain/exams/question-rules.ts` (`validateQuestionDomainRules`) and validated at API boundaries by `src/schemas/exams.ts` (`upsertQuestionSchema`):

| `question_type` | Description | Option Rules | Answer Key Rules (`question_answer_keys`) | Scoring Policy |
|---|---|---|---|---|
| `single_choice` | Multiple-choice with one correct answer | 2–6 non-empty options, unique normalized `optionKey` | Exactly 1 key matching a defined option | `exact_match` |
| `multiple_choice` | Multiple-choice with multiple correct answers | 2–6 non-empty options, unique normalized `optionKey` | 1 or more keys matching defined options | `exact_match` (or `partial_credit_disabled`) |
| `true_false` | Binary Benar / Salah | Exactly 2 normalized options (`A`, `B` / True-False) | Exactly 1 key (`A` or `B`) | `exact_match` |
| `essay` | Open-ended written response | Empty options (`[]`) | Empty keys (`[]`); optional `rubric_notes` | `manual_rubric` |

Common rules enforced by both domain validators and PostgreSQL `CHECK` constraints:
- Stem length must be at least 3 characters after sanitization.
- Points must satisfy $0 < \text{points} \le 1000$.
- Duplicate option keys within a single version are rejected.

---

## 2. Immutable Question Versioning & Answer-Key Separation

Question entities separate mutable metadata from immutable version snapshots (`supabase/migrations/20261112000004_phase2_question_bank_and_exams.sql` and `20261112000005_phase2_rls_and_publish_rpc.sql`):

1. **`questions`** — Logical question identity (`question_type`, `difficulty`, `topic`, `tags[]`, `status`: `draft | active | archived`, `content_fingerprint`, `current_version_id`). `question_type` cannot be changed after creation (teachers use **Duplikasi Soal** instead).
2. **`question_versions`** — Append-only revision snapshots (`version_number >= 1`, `stem`, `explanation`, `points`, `scoring_policy`, `rubric_notes`, `preserve_option_order`). Protected by `trg_question_versions_immutable` (`prevent_immutable_snapshot_mutation()`), blocking `UPDATE` and unauthorized `DELETE`.
3. **`question_options`** — Immutable display options per version (`option_key`, `option_text`, `display_order`) **without** any `is_correct` flag in the options table. Protected by `trg_question_options_immutable`.
4. **`question_answer_keys`** — Strictly separated table storing `correct_option_keys text[]` and `scoring_metadata jsonb` per `question_version_id`. Protected by `trg_question_answer_keys_immutable` and isolated via RLS so student tokens never have `SELECT` access.

Creating or updating a question executes inside atomic PostgreSQL RPCs (`create_question_with_version`, `update_question_new_version`). Editing an existing question appends `version_number + 1` and updates `questions.current_version_id` without altering already published `exam_version_questions`.

---

## 3. Content Sanitization & Safe Math Rendering

Implemented in `src/lib/question-content.ts` and `src/components/features/exams/question-content-renderer.tsx`:

- `sanitizePlainQuestionText()` strips control bytes and trims input while preserving literal math expressions (`$...$`, `$$...$$`).
- `renderSafeQuestionHtml()` tokenizes display math (`$$...$$`) and inline math (`$...$`), HTML-escapes all non-math prose (`&`, `<`, `>`, `"`, `'`) to neutralize `<script>` / `<img onerror=...>` / DOM XSS payloads, and renders TeX via `katex.renderToString(..., { strict: "ignore", trust: false, throwOnError: false })`.
- `katex/dist/katex.min.css` is imported in `src/app/layout.tsx` so local bundled fonts work under the strict `font-src 'self' data:` Content-Security-Policy in `next.config.ts`.
- Media attachments (`questions.attachment_metadata jsonb`) store validated metadata placeholders in Phase 2 pending Phase 3+ private bucket signed-URL media pipelines.

---

## 4. Bulk CSV & Excel (`.xlsx`) Import Pipeline

Implemented in `src/domain/exams/import-parser.ts`, `src/services/question-bank-service.ts`, and `/api/teacher/questions/import/*`:

1. **Official Templates (`GET /api/teacher/questions/import/template?format=csv|xlsx`):** Generates ready-to-fill templates using `IMPORT_TEMPLATE_HEADERS` (`question_type`, `difficulty`, `topic`, `tags`, `points`, `scoring_policy`, `stem`, `option_a`..`option_e`, `correct_answers`, `explanation`, `rubric_notes`, `preserve_option_order`).
2. **Hard Limits:** Maximum upload size `2 MB` (`MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024`) and maximum `500` rows (`MAX_IMPORT_ROWS = 500`).
3. **Spreadsheet Security Guards:**
   - Rejects Excel `.xlsx` cells containing spreadsheet formulas (`cell.formula` or shared formula values) in `extractWorkbookRows()`.
   - Rejects cells beginning with dangerous formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) unless clearly numeric negative literals where applicable.
   - Runs `sanitizePlainQuestionText` and domain rule validation per row.
4. **Deduplication:** Computes SHA-256 `normalizeQuestionFingerprint(questionType, stem, options)` against both existing bank questions for the same subject (`fetchExistingFingerprints`) and earlier rows within the uploaded file.
5. **Two-Step Preview & Atomic Commit:**
   - `POST /api/teacher/questions/import/preview` parses and validates without writing to PostgreSQL, returning valid rows and per-row rejection reasons.
   - `POST /api/teacher/questions/import` calls `import_questions_atomic` PL/pgSQL RPC (either aborting if rejected rows exist when `allowSkipRejected=false`, or atomically committing valid rows + recording an `import_batches` audit record).

---

## 5. Authorization & Ownership

- `teacher` users can read/write questions **only** for subjects explicitly assigned to them in active `teacher_assignments` rows within the same school (`auth_teacher_teaches_subject` / `auth_can_access_subject_content`).
- `admin` users have full school-wide visibility (`auth_is_school_admin`) across active subjects in their school.
- `student` users have zero access to `question_banks`, `questions`, `question_versions`, `question_options`, `question_answer_keys`, or `/api/teacher/questions/*`.
