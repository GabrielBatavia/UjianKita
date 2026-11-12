import { expect, test } from "@playwright/test";

test.describe("Phase 4 Security, Monitoring & Responsive Route Protection", () => {
  test("redirects unauthenticated visitors away from monitoring portals", async ({
    page,
  }) => {
    for (const route of [
      "/teacher/monitoring",
      "/teacher/monitoring/00000000-0000-4000-8000-000000000001",
      "/admin/monitoring",
    ]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("rejects unauthenticated requests to all Phase 4 monitoring and SEB endpoints", async ({
    request,
  }) => {
    const dummyId = "00000000-0000-4000-8000-000000000001";
    const endpoints: Array<{ method: "GET" | "POST" | "PUT" | "PATCH"; url: string }> = [
      { method: "GET", url: "/api/teacher/monitoring" },
      { method: "GET", url: `/api/teacher/monitoring/${dummyId}` },
      { method: "GET", url: `/api/teacher/monitoring/${dummyId}/incidents` },
      { method: "GET", url: `/api/teacher/monitoring/${dummyId}/report?format=csv` },
      { method: "GET", url: `/api/teacher/incidents/${dummyId}` },
      { method: "PATCH", url: `/api/teacher/incidents/${dummyId}` },
      { method: "GET", url: `/api/teacher/exams/${dummyId}/security-policy` },
      { method: "PUT", url: `/api/teacher/exams/${dummyId}/security-policy` },
      { method: "POST", url: `/api/teacher/attempts/${dummyId}/browser-override` },
      { method: "GET", url: "/api/admin/monitoring" },
      { method: "POST", url: "/api/admin/monitoring/retention" },
      { method: "POST", url: `/api/student/attempts/${dummyId}/heartbeat` },
      { method: "GET", url: `/api/student/exams/${dummyId}/policy` },
      { method: "GET", url: `/api/student/exams/${dummyId}/seb-config` },
      { method: "POST", url: `/api/student/exams/${dummyId}/seb-verify` },
    ];

    for (const ep of endpoints) {
      const res = await request.fetch(ep.url, {
        method: ep.method,
        data: ep.method === "GET" ? undefined : {},
      });
      expect([401, 403, 503]).toContain(res.status());
    }
  });

  test("renders login and public landing cleanly across desktop and Android/iOS mobile viewports (emulation only, not physical ExamBro/SEB hardware)", async ({
    browser,
  }) => {
    const viewports = [
      { name: "Desktop 1280x720", width: 1280, height: 720 },
      { name: "Android ExamBro Viewport 390x844", width: 390, height: 844 },
      { name: "iPhone SEB Viewport 375x812", width: 375, height: 812 },
    ];

    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await expect(page.locator("form")).toBeVisible();
      const overflowPx = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflowPx).toBeLessThanOrEqual(2);
      await context.close();
    }
  });
});
