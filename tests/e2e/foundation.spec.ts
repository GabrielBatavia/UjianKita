import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("UjianKita Phase 1 Foundation E2E", () => {
  test("landing page renders Bahasa Indonesia copy, security headers, and zero horizontal overflow", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);

    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");

    await expect(
      page.getByRole("heading", {
        name: /Platform Ujian Sekolah Berbasis Komputer/i,
      })
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });

  test("health endpoint responds with honest service telemetry", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status());
    const data = (await res.json()) as {
      service: string;
      phase: string;
      supabase: { configured: boolean; reachable: boolean };
    };
    expect(data.service).toBe("ujiankita-web");
    expect(data.phase).toBe("phase-1");
    expect(typeof data.supabase.configured).toBe("boolean");
  });

  test("unauthenticated visits to protected portals fail closed and redirect to /login", async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    for (const protectedRoute of [
      "/dashboard",
      "/admin",
      "/admin/exams",
      "/admin/exams/sample-exam-id",
      "/admin/exams/sample-exam-id/preview",
      "/teacher",
      "/teacher/questions",
      "/teacher/questions/new",
      "/teacher/questions/import",
      "/teacher/exams",
      "/teacher/exams/new",
      "/teacher/exams/sample-exam-id",
      "/teacher/exams/sample-exam-id/preview",
      "/teacher/schedules",
      "/student",
    ]) {
      await page.goto(protectedRoute, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/login/);
    }

    for (const apiRoute of [
      "/api/teacher/questions",
      "/api/teacher/exams",
      "/api/teacher/grading",
      "/api/admin/exams",
      "/api/student/exams",
      "/api/student/results",
    ]) {
      const res = await request.get(apiRoute);
      expect([401, 503]).toContain(res.status());
    }

    expect(pageErrors).toEqual([]);
  });

  test("login and forgot-password pages pass automated WCAG 2.2 AA accessibility checks", async ({
    page,
  }) => {
    for (const path of ["/", "/login", "/forgot-password"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      expect(results.violations, `Accessibility violations on ${path}`).toEqual([]);
    }
  });

  test("404 page renders Bahasa Indonesia recovery navigation cleanly", async ({ page }) => {
    const res = await page.goto("/halaman-tidak-ada-404");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /Halaman Tidak Ditemukan/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Kembali ke Beranda/i })).toBeVisible();
  });
});
