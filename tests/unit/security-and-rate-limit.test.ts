import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimitForTests } from "@/lib/rate-limit";
import {
  mapAuthErrorToSafeMessage,
  sanitizeInternalRedirectPath,
} from "@/lib/security";
import { getPublicEnvStatus, requireServiceRoleEnv } from "@/lib/env";

describe("Security utilities & rate limiter", () => {
  afterEach(() => {
    resetRateLimitForTests();
  });

  it("blocks open-redirect payloads and permits clean internal paths", () => {
    expect(sanitizeInternalRedirectPath("https://evil.example/phish")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("//evil.example")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeInternalRedirectPath("/admin/students?q=1")).toBe("/admin/students?q=1");
  });

  it("maps authentication errors without disclosing account existence", () => {
    const badCreds = mapAuthErrorToSafeMessage("Invalid login credentials");
    expect(badCreds).not.toContain("Invalid login credentials");
    expect(badCreds).toContain("Email atau kata sandi tidak sesuai");
  });

  it("enforces sliding-window rate limits and recovers after window expiry", () => {
    const base = 1_700_000_000_000;
    expect(checkRateLimit({ key: "k1", limit: 2, windowMs: 10_000, nowMs: base }).allowed).toBe(
      true
    );
    expect(
      checkRateLimit({ key: "k1", limit: 2, windowMs: 10_000, nowMs: base + 1000 }).allowed
    ).toBe(true);

    const blocked = checkRateLimit({ key: "k1", limit: 2, windowMs: 10_000, nowMs: base + 2000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(8);

    // After sliding window passes
    expect(
      checkRateLimit({ key: "k1", limit: 2, windowMs: 10_000, nowMs: base + 11_000 }).allowed
    ).toBe(true);
  });

  it("reports unconfigured env gracefully without throwing on status check", () => {
    const status = getPublicEnvStatus();
    expect(typeof status.configured).toBe("boolean");
    expect(typeof status.appUrl).toBe("string");
  });

  it("throws explicitly when service role env is missing", () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => requireServiceRoleEnv()).toThrow();
    if (prev !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });
});
