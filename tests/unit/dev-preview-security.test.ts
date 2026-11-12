import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

describe("Dev Preview Route Protection & Security Isolation", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableDevPreview = process.env.ENABLE_DEV_PREVIEW;

  beforeEach(() => {
    delete process.env.ENABLE_DEV_PREVIEW;
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
    if (originalEnableDevPreview !== undefined) {
      process.env.ENABLE_DEV_PREVIEW = originalEnableDevPreview;
    } else {
      delete process.env.ENABLE_DEV_PREVIEW;
    }
  });

  it("blocks /dev-preview with HTTP 404 in production environment by default", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.ENABLE_DEV_PREVIEW;

    const request = new NextRequest("http://localhost:3000/dev-preview");
    const response = await updateSupabaseSession(request);

    expect(response.status).toBe(404);
  });

  it("blocks /dev-preview nested paths with HTTP 404 in production by default", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.ENABLE_DEV_PREVIEW;

    const request = new NextRequest("http://localhost:3000/dev-preview/sub-path");
    const response = await updateSupabaseSession(request);

    expect(response.status).toBe(404);
  });

  it("allows /dev-preview when ENABLE_DEV_PREVIEW is explicitly 'true'", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.ENABLE_DEV_PREVIEW = "true";

    const request = new NextRequest("http://localhost:3000/dev-preview");
    const response = await updateSupabaseSession(request);

    expect(response.status).not.toBe(404);
  });

  it("allows /dev-preview in non-production development mode", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.ENABLE_DEV_PREVIEW;

    const request = new NextRequest("http://localhost:3000/dev-preview");
    const response = await updateSupabaseSession(request);

    expect(response.status).not.toBe(404);
  });
});
