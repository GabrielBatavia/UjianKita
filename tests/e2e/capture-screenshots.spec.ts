import { test } from "@playwright/test";
import path from "node:path";

const VIEWPORTS = [
  { name: "320px-small-android", width: 320, height: 640 },
  { name: "360px-compact-android", width: 360, height: 800 },
  { name: "375px-standard-iphone", width: 375, height: 667 },
  { name: "390px-modern-mobile", width: 390, height: 844 },
  { name: "430px-large-mobile", width: 430, height: 932 },
  { name: "768px-tablet-portrait", width: 768, height: 1024 },
  { name: "1024px-small-laptop", width: 1024, height: 768 },
  { name: "1440px-desktop", width: 1440, height: 900 },
];

const PUBLIC_PAGES = [
  { slug: "landing", path: "/" },
  { slug: "login", path: "/login" },
  { slug: "forgot-password", path: "/forgot-password" },
  { slug: "not-found", path: "/halaman-yang-tidak-ada" },
];

const PREVIEW_TABS = [
  { slug: "student-exam-player", buttonLabel: "Exam Player" },
  { slug: "student-instructions", buttonLabel: "Instruksi" },
  { slug: "student-review", buttonLabel: "Tinjauan Jawaban" },
  { slug: "student-receipt", buttonLabel: "Bukti Pengumpulan" },
  { slug: "teacher-question-bank", buttonLabel: "Bank Soal" },
  { slug: "admin-students", buttonLabel: "Data Siswa" },
  { slug: "teacher-monitoring", buttonLabel: "Monitoring" },
];

test.describe("Capture UI Screenshots", () => {
  for (const vp of VIEWPORTS) {
    // 1. Public Pages
    for (const pageItem of PUBLIC_PAGES) {
      test(`capture ${pageItem.slug} at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(pageItem.path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(400);
        const targetDir = process.env.SCREENSHOT_STAGE === "redesign" ? "redesign" : "baseline";
        const screenshotPath = path.resolve(
          process.cwd(),
          `docs/screenshots/${targetDir}/${pageItem.slug}-${vp.name}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
      });
    }

    // 2. Dev Preview Component States (Exam Player, Review, Bank Soal, etc.)
    for (const tab of PREVIEW_TABS) {
      test(`capture preview ${tab.slug} at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto("/dev-preview", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(400);
        await page.getByRole("button", { name: tab.buttonLabel }).click();
        await page.waitForTimeout(300);

        const targetDir = process.env.SCREENSHOT_STAGE === "redesign" ? "redesign" : "baseline";
        const screenshotPath = path.resolve(
          process.cwd(),
          `docs/screenshots/${targetDir}/${tab.slug}-${vp.name}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
      });
    }
  }
});
