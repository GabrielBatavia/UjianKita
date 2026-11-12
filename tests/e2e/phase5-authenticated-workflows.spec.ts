import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnvLocalIfPresent() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadDotEnvLocalIfPresent();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const HAS_LIVE_SUPABASE =
  Boolean(SUPABASE_URL) &&
  Boolean(SERVICE_KEY) &&
  !SUPABASE_URL.includes("example") &&
  !SERVICE_KEY.includes("example");

interface SeededSchoolFixture {
  schoolId: string;
  examId: string;
  teacherEmail: string;
  studentEmail: string;
  ephemeralCred: string;
  userIds: string[];
}

async function cleanupFixture(service: SupabaseClient, schoolId: string, userIds: string[]) {
  const bySchool = [
    "submission_receipts",
    "grade_adjustments",
    "manual_grading_entries",
    "exam_grades",
    "incident_review_actions",
    "exam_security_incident_events",
    "exam_security_incidents",
    "attempt_monitoring_presence",
    "attempt_events",
    "answer_revisions",
    "answer_save_requests",
    "student_answers",
    "exam_submissions",
    "attempt_question_assignments",
    "exam_attempts",
    "exam_publication_events",
    "exam_schedules",
    "exam_assignments",
    "exam_draft_questions",
    "exam_version_answer_keys",
    "exam_version_questions",
    "exam_versions",
    "exams",
    "monitoring_audit_events",
    "exam_student_browser_overrides",
    "exam_security_policy_versions",
    "exam_security_policies",
  ];
  for (const table of bySchool) {
    await service.from(table).delete().eq("school_id", schoolId);
  }
  await service.from("questions").delete().eq("school_id", schoolId);
  await service.from("question_banks").delete().eq("school_id", schoolId);
  await service.from("teacher_assignments").delete().eq("school_id", schoolId);
  await service.from("class_enrollments").delete().eq("school_id", schoolId);
  await service.from("teachers").delete().eq("school_id", schoolId);
  await service.from("students").delete().eq("school_id", schoolId);
  await service.from("classes").delete().eq("school_id", schoolId);
  await service.from("subjects").delete().eq("school_id", schoolId);
  await service.from("academic_years").delete().eq("school_id", schoolId);
  await service.from("audit_events").delete().eq("school_id", schoolId);
  await service.from("schools").delete().eq("id", schoolId);
  for (const uid of userIds) {
    await service.auth.admin.deleteUser(uid);
  }
}

async function seedExamFixture(
  service: SupabaseClient,
  tag: string
): Promise<SeededSchoolFixture> {
  const suffix = randomUUID().slice(0, 8);
  const ephemeralCred = randomBytes(16).toString("base64url");
  const userIds: string[] = [];

  const { data: roles } = await service.from("roles").select("id, code");
  const roleIdByCode = new Map((roles ?? []).map((r) => [r.code as string, r.id as string]));

  const { data: school, error: schErr } = await service
    .from("schools")
    .insert({
      code: `E2E-${tag}-${suffix}`,
      name: `SMA E2E ${tag} ${suffix}`,
      level: "SMA",
    })
    .select("id")
    .single();
  if (schErr || !school) throw new Error(`Seed school failed: ${schErr?.message}`);
  const schoolId = school.id as string;

  const { data: year, error: yrErr } = await service
    .from("academic_years")
    .insert({
      school_id: schoolId,
      name: "2026/2027",
      semester: "Ganjil",
      starts_on: "2026-07-01",
      ends_on: "2026-12-31",
      is_active: true,
    })
    .select("id")
    .single();
  if (yrErr || !year) throw new Error(`Seed year failed: ${yrErr?.message}`);

  const { data: cls, error: clsErr } = await service
    .from("classes")
    .insert({
      school_id: schoolId,
      academic_year_id: year.id,
      name: `XII-E2E-${suffix}`,
      grade_level: "12",
    })
    .select("id")
    .single();
  if (clsErr || !cls) throw new Error(`Seed class failed: ${clsErr?.message}`);

  const { data: subj, error: subjErr } = await service
    .from("subjects")
    .insert({
      school_id: schoolId,
      code: `INF-${suffix}`,
      name: "Informatika",
    })
    .select("id")
    .single();
  if (subjErr || !subj) throw new Error(`Seed subject failed: ${subjErr?.message}`);

  const createUser = async (email: string, fullName: string, roleCode: string) => {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: ephemeralCred,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw new Error(`Create user failed: ${error?.message}`);
    const uid = data.user.id;
    userIds.push(uid);
    await service.from("user_profiles").upsert({
      id: uid,
      school_id: schoolId,
      email,
      full_name: fullName,
      is_active: true,
    });
    await service.from("user_roles").insert({
      school_id: schoolId,
      user_id: uid,
      role_id: roleIdByCode.get(roleCode)!,
    });
    return uid;
  };

  const teacherEmail = `guru-${tag}-${suffix}@e2e.local`;
  const studentEmail = `siswa-${tag}-${suffix}@e2e.local`;
  const teacherId = await createUser(teacherEmail, "Guru E2E Uji", "teacher");
  const studentUserId = await createUser(studentEmail, "Siswa E2E Uji", "student");

  const { data: bank, error: bankErr } = await service
    .from("question_banks")
    .insert({
      school_id: schoolId,
      subject_id: subj.id,
      created_by: teacherId,
      title: `Bank E2E ${suffix}`,
    })
    .select("id")
    .single();
  if (bankErr || !bank) throw new Error(`Seed bank failed: ${bankErr?.message}`);

  const { data: teacherRow } = await service
    .from("teachers")
    .insert({ school_id: schoolId, user_id: teacherId, nip: `NIP-${suffix}` })
    .select("id")
    .single();
  await service.from("teacher_assignments").insert({
    school_id: schoolId,
    teacher_id: teacherRow!.id,
    subject_id: subj.id,
    class_id: cls.id,
    academic_year_id: year.id,
  });

  const { data: studentRow } = await service
    .from("students")
    .insert({
      school_id: schoolId,
      user_id: studentUserId,
      nis: `NIS-${suffix}`,
    })
    .select("id")
    .single();
  await service.from("class_enrollments").insert({
    school_id: schoolId,
    student_id: studentRow!.id,
    class_id: cls.id,
    academic_year_id: year.id,
    status: "active",
  });

  // Create 1 single_choice question + 1 essay question using authenticated teacher RPC
  const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await anon.auth.signInWithPassword({ email: teacherEmail, password: ephemeralCred });

  const qMcRes = await anon.rpc("create_question_with_version", {
    p_question_bank_id: bank.id,
    p_subject_id: subj.id,
    p_question_type: "single_choice",
    p_difficulty: "easy",
    p_topic: "Basis Data",
    p_tags: ["e2e"],
    p_status: "active",
    p_attachment_metadata: [],
    p_content_fingerprint: `fp-mc-${suffix}`,
    p_stem: "Bahasa kueri standar untuk basis data relasional adalah?",
    p_explanation: "SQL adalah standar query relasional.",
    p_points: 40,
    p_scoring_policy: "exact_match",
    p_rubric_notes: null,
    p_preserve_option_order: true,
    p_options: [
      { optionKey: "A", optionText: "SQL", displayOrder: 0 },
      { optionKey: "B", optionText: "HTML", displayOrder: 1 },
    ],
    p_correct_option_keys: ["A"],
  });
  if (qMcRes.error) throw new Error(`Seed Q1 failed: ${qMcRes.error.message}`);

  const qEsRes = await anon.rpc("create_question_with_version", {
    p_question_bank_id: bank.id,
    p_subject_id: subj.id,
    p_question_type: "essay",
    p_difficulty: "medium",
    p_topic: "Keamanan",
    p_tags: ["e2e"],
    p_status: "active",
    p_attachment_metadata: [],
    p_content_fingerprint: `fp-es-${suffix}`,
    p_stem: "Jelaskan mengapa otorisasi harus diverifikasi di sisi server!",
    p_explanation: null,
    p_points: 60,
    p_scoring_policy: "manual_rubric",
    p_rubric_notes: "Sebutkan bahwa klien dapat dimanipulasi.",
    p_preserve_option_order: true,
    p_options: [],
    p_correct_option_keys: [],
  });
  if (qEsRes.error) throw new Error(`Seed Q2 failed: ${qEsRes.error.message}`);

  const now = Date.now();
  const { data: exam, error: exErr } = await anon
    .from("exams")
    .insert({
      school_id: schoolId,
      subject_id: subj!.id,
      academic_year_id: year!.id,
      created_by: teacherId,
      title: `Ujian E2E Nyata ${tag} ${suffix}`,
      status: "DRAFT",
      duration_minutes: 45,
      max_attempts: 1,
      passing_score: 70,
      randomize_questions: false,
      randomize_options: false,
      result_release_policy: "manual",
      allow_student_review: true,
      starts_at: new Date(now - 5 * 60_000).toISOString(),
      ends_at: new Date(now + 60 * 60_000).toISOString(),
    })
    .select("id, version_lock")
    .single();
  if (exErr || !exam) throw new Error(`Seed exam failed: ${exErr?.message}`);

  await anon.from("exam_draft_questions").insert([
    {
      school_id: schoolId,
      exam_id: exam.id,
      question_id: (qMcRes.data as { question_id: string }).question_id,
      display_order: 1,
    },
    {
      school_id: schoolId,
      exam_id: exam.id,
      question_id: (qEsRes.data as { question_id: string }).question_id,
      display_order: 2,
    },
  ]);

  await anon.from("exam_assignments").insert({
    school_id: schoolId,
    exam_id: exam.id,
    class_id: cls!.id,
    assigned_by: teacherId,
  });

  await anon.from("exam_schedules").insert({
    school_id: schoolId,
    exam_id: exam.id,
    class_id: cls!.id,
    starts_at: new Date(now - 5 * 60_000).toISOString(),
    ends_at: new Date(now + 60 * 60_000).toISOString(),
    duration_minutes: 45,
    max_attempts: 1,
    late_join_minutes: 30,
  });

  const pub = await anon.rpc("publish_exam_atomic", {
    p_exam_id: exam.id,
    p_expected_version_lock: exam.version_lock,
    p_notes: "E2E Playwright publish",
  });
  if (pub.error) throw new Error(`Publish exam failed: ${pub.error.message}`);

  return {
    schoolId,
    examId: exam.id as string,
    teacherEmail,
    studentEmail,
    ephemeralCred,
    userIds,
  };
}

test.describe("Phase 5 Authenticated End-to-End Workflows (Local Supabase)", () => {
  test.setTimeout(90_000);

  test("complete authenticated student exam, reload resume, submission receipt, teacher grading & release, and live monitoring", async ({
    browser,
  }, testInfo) => {
    test.skip(
      !HAS_LIVE_SUPABASE,
      "Requires local or test Supabase env vars (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)."
    );

    const service = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tag = testInfo.project.name.replace(/[^a-zA-Z0-9]/g, "");
    const fixture = await seedExamFixture(service, tag);

    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(`[${page.url()}] ${err.message}`));

    try {
      // 1. Student login via real UI
      await page.goto("/login", { waitUntil: "networkidle" });
      await page.waitForFunction(() =>
        Object.keys(document.querySelector("form") ?? {}).some((k) => k.startsWith("__reactProps"))
      );
      await page.fill("#login-email", fixture.studentEmail);
      await page.fill("#login-password", fixture.ephemeralCred);
      await page.getByRole("button", { name: /Masuk ke UjianKita/i }).click();
      await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

      // 2. Open exam instructions, verify rules checkbox enables start button, start exam
      await page.goto(`/student/exams/${fixture.examId}/instructions`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { name: /Ujian E2E Nyata/i })).toBeVisible({
        timeout: 15_000,
      });
      const startBtn = page.getByRole("button", { name: /Mulai Ujian Sekarang/i });
      await expect(startBtn).toBeDisabled();
      const ackBox = page.getByRole("checkbox");
      await ackBox.waitFor({ state: "visible", timeout: 10_000 });
      await ackBox.click();
      await expect(startBtn).toBeEnabled({ timeout: 10_000 });
      await startBtn.click();
      await expect(page).toHaveURL(/\/student\/attempts\/[0-9a-f-]+$/, {
        timeout: 15_000,
      });

      const attemptUrl = page.url();
      const attemptId = attemptUrl.split("/").pop()!;

      // Verify zero horizontal overflow on desktop/mobile viewports
      const overflowPx = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflowPx).toBeLessThanOrEqual(2);

      // 3. Answer Q1 (single choice "SQL") and wait for server-confirmed "Tersimpan"
      await expect(page.getByText(/Bahasa kueri standar/i)).toBeVisible({ timeout: 15_000 });
      await page.locator('input[type="radio"][value="A"]').check();
      await expect(page.getByText("Tersimpan", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });

      // 4. Reload browser mid-exam and verify persisted server answer survives reload
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator('input[type="radio"][value="A"]')).toBeChecked({
        timeout: 15_000,
      });

      // 5. Navigate to Q2 (essay), type answer, flush on blur, and proceed to Review
      await page.getByRole("button", { name: /Berikutnya/i }).click();
      await expect(page.getByText(/otorisasi harus diverifikasi/i)).toBeVisible();
      const essayText = "Karena permintaan HTTP dan state klien dapat dimodifikasi oleh pengguna.";
      const essayBox = page.locator("textarea");
      await essayBox.fill(essayText);
      await essayBox.blur();
      await expect(page.getByText("Tersimpan", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByRole("button", { name: /Tinjau & Kumpulkan/i }).click();
      await expect(page).toHaveURL(new RegExp(`/student/attempts/${attemptId}/review`), {
        timeout: 15_000,
      });

      // 6. Confirm submission and verify receipt
      await page.getByRole("button", { name: /^Kumpulkan Ujian$/i }).click();
      await expect(page.getByText(/Konfirmasi Pengumpulan Resmi/i)).toBeVisible();
      await page.getByRole("button", { name: /Ya, Kumpulkan Sekarang/i }).click();
      await expect(page).toHaveURL(new RegExp(`/student/attempts/${attemptId}/receipt`), {
        timeout: 15_000,
      });
      await expect(
        page.getByRole("heading", { name: /Bukti Pengumpulan Ujian/i })
      ).toBeVisible();

      // Run Axe WCAG check on desktop-chromium for student receipt page
      if (testInfo.project.name === "desktop-chromium") {
        const axeReceipt = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        expect(axeReceipt.violations).toEqual([]);
      }

      // Desktop-only second half: Teacher logs in via separate browser context -> grades essay & releases -> checks monitoring -> Student sees released result!
      if (testInfo.project.name === "desktop-chromium") {
        const teacherContext = await browser.newContext();
        const teacherPage = await teacherContext.newPage();

        await teacherPage.goto("/login", { waitUntil: "networkidle" });
        await teacherPage.waitForFunction(() =>
          Object.keys(document.querySelector("form") ?? {}).some((k) => k.startsWith("__reactProps"))
        );
        await teacherPage.fill("#login-email", fixture.teacherEmail);
        await teacherPage.fill("#login-password", fixture.ephemeralCred);
        await teacherPage.getByRole("button", { name: /Masuk ke UjianKita/i }).click();
        await expect(teacherPage).toHaveURL(/\/teacher/, { timeout: 15_000 });

        await teacherPage.goto(`/teacher/exams/${fixture.examId}/grading`, {
          waitUntil: "domcontentloaded",
        });
        await expect(teacherPage.getByText(essayText).first()).toBeVisible({ timeout: 15_000 });

        const scoreInput = teacherPage.locator('input[id^="sc-"]').first();
        await scoreInput.fill("55");
        await teacherPage.getByRole("button", { name: /Simpan & Rilis Hasil Siswa/i }).click();
        await expect(teacherPage.getByText(/95/).first()).toBeVisible({ timeout: 10_000 });

        // Open Teacher Live Monitoring Control Center for this exam
        await teacherPage.goto(`/teacher/monitoring/${fixture.examId}`, {
          waitUntil: "domcontentloaded",
        });
        await expect(teacherPage.getByText(/Siswa E2E Uji/i).first()).toBeVisible({
          timeout: 15_000,
        });

        await teacherContext.close();

        // Student verifies released score now visible at /student/results
        await page.goto("/student/results", { waitUntil: "domcontentloaded" });
        await expect(page.getByText(/Ujian E2E Nyata/i).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/95/).first()).toBeVisible({ timeout: 10_000 });
      }

      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await context.close();
      await cleanupFixture(service, fixture.schoolId, fixture.userIds);
    }
  });
});
