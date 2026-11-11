import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postLogin } from "@/app/api/auth/login/route";
import { GET as getAdminStudents, POST as postAdminStudent } from "@/app/api/admin/students/route";
import { PATCH as patchAdminSettings } from "@/app/api/admin/settings/route";
import { resetRateLimitForTests } from "@/lib/rate-limit";

describe("API Route Handler Security & Authorization Boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitForTests();
  });

  it("GET /api/health returns valid JSON report without leaking secrets", async () => {
    const response = await getHealth();
    const json = (await response.json()) as Record<string, unknown>;
    expect([200, 503]).toContain(response.status);
    expect(json.service).toBe("ujiankita-web");
    expect(json.phase).toBe("phase-1");
    expect(JSON.stringify(json)).not.toContain("SERVICE_ROLE");
  });

  it("POST /api/auth/login rejects invalid input and returns safe errors", async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic_key_value";

    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email: "not-an-email", password: "123" }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(400);

    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;

    if (prevKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
  });

  it("blocks unauthenticated requests to admin endpoints", async () => {
    const getRes = await getAdminStudents();
    expect([401, 503]).toContain(getRes.status);

    const postReq = new NextRequest("http://localhost:3000/api/admin/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const postRes = await postAdminStudent(postReq);
    expect([401, 503]).toContain(postRes.status);

    const patchReq = new NextRequest("http://localhost:3000/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const patchRes = await patchAdminSettings(patchReq);
    expect([401, 503]).toContain(patchRes.status);
  });
});

// Live Supabase RLS boundary tests run ONLY when explicit synthetic test env vars are provided
const liveUrl = process.env.TEST_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY;
const liveService = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const hasLiveSupabase = Boolean(liveUrl && liveAnon && liveService);

describe.skipIf(!hasLiveSupabase)("Live Supabase PostgreSQL & RLS Enforcement", () => {
  it("prevents unauthenticated anon client from reading schools, students, or audit_events", async () => {
    const anon = createClient(liveUrl!, liveAnon!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [schoolsRes, studentsRes, auditRes] = await Promise.all([
      anon.from("schools").select("id"),
      anon.from("students").select("id"),
      anon.from("audit_events").select("id"),
    ]);

    expect(schoolsRes.data ?? []).toHaveLength(0);
    expect(studentsRes.data ?? []).toHaveLength(0);
    expect(auditRes.data ?? []).toHaveLength(0);
  });

  it("verifies audit_events immutability trigger rejects updates and deletes", async () => {
    const admin = createClient(liveUrl!, liveService!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows } = await admin.from("audit_events").select("id").limit(1);
    if (rows && rows.length > 0 && rows[0]) {
      const targetId = rows[0].id as string;
      const updateRes = await admin
        .from("audit_events")
        .update({ summary: "tampered" })
        .eq("id", targetId);
      expect(updateRes.error).not.toBeNull();

      const deleteRes = await admin.from("audit_events").delete().eq("id", targetId);
      expect(deleteRes.error).not.toBeNull();
    }
  });
});
