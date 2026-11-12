import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("UjianKita Phase 3 Security Boundaries & Mobile Exam Viewport Hygiene", () => {
  test("all Phase 3 student and grading endpoints return non-cacheable fail-closed responses", async ({
    request,
  }) => {
    const routes = [
      { method: "GET", url: "/api/student/exams" },
      { method: "GET", url: "/api/student/exams/non-existent" },
      { method: "POST", url: "/api/student/exams/non-existent/start" },
      { method: "GET", url: "/api/student/attempts/non-existent" },
      { method: "GET", url: "/api/student/attempts/non-existent/time" },
      { method: "PUT", url: "/api/student/attempts/non-existent/answers" },
      { method: "PATCH", url: "/api/student/attempts/non-existent/flag" },
      { method: "POST", url: "/api/student/attempts/non-existent/submit" },
      { method: "GET", url: "/api/student/attempts/non-existent/receipt" },
      { method: "GET", url: "/api/student/results" },
      { method: "GET", url: "/api/teacher/grading" },
      { method: "GET", url: "/api/teacher/exams/non-existent/attempts" },
      { method: "POST", url: "/api/teacher/exams/non-existent/release" },
      { method: "PUT", url: "/api/teacher/attempts/non-existent/grade" },
      { method: "POST", url: "/api/teacher/attempts/non-existent/adjust" },
      { method: "POST", url: "/api/admin/attempts/non-existent/cancel" },
    ];

    for (const r of routes) {
      const res = await request.fetch(r.url, {
        method: r.method,
        headers: { "Content-Type": "application/json" },
        data: r.method === "GET" ? undefined : {},
      });
      expect([401, 403, 503], `Unexpected status for ${r.method} ${r.url}`).toContain(res.status());
      const cc = res.headers()["cache-control"] ?? "";
      expect(cc, `Missing no-store Cache-Control header on ${r.url}`).toContain("no-store");
    }
  });

  test("unauthenticated visits to Phase 3 student and grading portals redirect cleanly to /login", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    for (const protectedRoute of [
      "/teacher/grading",
      "/teacher/exams/sample-exam-id/grading",
      "/student/exams",
      "/student/exams/sample-exam-id",
      "/student/exams/sample-exam-id/instructions",
      "/student/attempts/sample-attempt-id",
      "/student/attempts/sample-attempt-id/review",
      "/student/attempts/sample-attempt-id/receipt",
      "/student/results",
    ]) {
      await page.goto(protectedRoute, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/login/);
    }

    expect(pageErrors).toEqual([]);
  });

  test("mobile ExamBro-sized viewport (390x844) renders login redirect cleanly without overflow or WCAG violations", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/student/exams");
    await expect(page).toHaveURL(/\/login/);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
