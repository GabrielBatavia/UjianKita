import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TEST_PAGES = [
  { name: "Landing", path: "/" },
  { name: "Login", path: "/login" },
  { name: "Forgot Password", path: "/forgot-password" },
  { name: "Dev Preview (Exam Player)", path: "/dev-preview" },
];

test.describe("Phase A: Automated Accessibility & Responsive Audit", () => {
  for (const pageItem of TEST_PAGES) {
    test(`Axe WCAG 2.1 AA audit for ${pageItem.name}`, async ({ page }) => {
      await page.goto(pageItem.path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Exclude Next.js dev overlay artifacts and intentional forensic watermark
        .exclude("nextjs-portal")
        .exclude("[data-testid='student-exam-watermark']")
        .analyze();

      const criticalViolations = accessibilityScanResults.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(
        criticalViolations,
        `Expected 0 critical/serious a11y violations on ${pageItem.name}, but found: ${JSON.stringify(
          criticalViolations.map((v) => ({ id: v.id, description: v.description, nodes: v.nodes.length })),
          null,
          2
        )}`
      ).toHaveLength(0);
    });
  }

  const VIEWPORTS = [320, 360, 375, 390, 430, 768, 1024, 1440];
  for (const width of VIEWPORTS) {
    test(`Verify zero horizontal overflow at ${width}px width on Exam Player`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/dev-preview", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);

      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    });
  }
});
