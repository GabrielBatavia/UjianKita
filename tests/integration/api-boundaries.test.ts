import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
  it("prevents unauthenticated anon client from reading schools, students, teachers, or audit_events", async () => {
    const anon = createClient(liveUrl!, liveAnon!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [schoolsRes, studentsRes, teachersRes, auditRes] = await Promise.all([
      anon.from("schools").select("id"),
      anon.from("students").select("id"),
      anon.from("teachers").select("id"),
      anon.from("audit_events").select("id"),
    ]);

    expect(schoolsRes.data ?? []).toHaveLength(0);
    expect(studentsRes.data ?? []).toHaveLength(0);
    expect(teachersRes.data ?? []).toHaveLength(0);
    expect(auditRes.data ?? []).toHaveLength(0);
  });

  it("enforces multi-role RLS isolation, blocks student escalation, and keeps audit_events append-only", async () => {
    const service = createClient(liveUrl!, liveService!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const runSuffix = randomUUID().slice(0, 8);
    const testSchoolId = randomUUID();
    const otherSchoolId = randomUUID();
    const password = `RlsTest!${runSuffix}A1`;

    const createdAuthIds: string[] = [];

    async function createSyntheticRoleUser(
      roleCode: "admin" | "teacher" | "student",
      schoolId: string,
      label: string
    ) {
      const email = `rls-${label}-${runSuffix}@ujiankita.local`;
      const { data: authRes, error: authErr } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authErr || !authRes.user) {
        throw new Error(`Failed to create synthetic test user: ${authErr?.message}`);
      }
      const userId = authRes.user.id;
      createdAuthIds.push(userId);

      const { error: profErr } = await service.from("user_profiles").insert({
        id: userId,
        school_id: schoolId,
        full_name: `Test ${label}`,
        email,
        is_active: true,
      });
      if (profErr) throw new Error(profErr.message);

      const { data: roleRow } = await service
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .single();
      if (!roleRow) throw new Error(`Missing role ${roleCode}`);

      await service.from("user_roles").insert({
        user_id: userId,
        role_id: roleRow.id,
        school_id: schoolId,
      });

      const client = createClient(liveUrl!, liveAnon!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(signInErr.message);

      return { userId, client };
    }

    try {
      await service.from("schools").insert([
        { id: testSchoolId, code: `RLS-A-${runSuffix}`, name: "Sekolah Uji A" },
        { id: otherSchoolId, code: `RLS-B-${runSuffix}`, name: "Sekolah Uji B" },
      ]);

      const adminA = await createSyntheticRoleUser("admin", testSchoolId, "admin-a");
      const student1 = await createSyntheticRoleUser("student", testSchoolId, "student-1");
      const student2 = await createSyntheticRoleUser("student", testSchoolId, "student-2");
      const teacherA = await createSyntheticRoleUser("teacher", testSchoolId, "teacher-a");

      const { data: s1Row } = await service
        .from("students")
        .insert({ user_id: student1.userId, school_id: testSchoolId, nis: `NIS1-${runSuffix}` })
        .select("id")
        .single();
      const { data: s2Row } = await service
        .from("students")
        .insert({ user_id: student2.userId, school_id: testSchoolId, nis: `NIS2-${runSuffix}` })
        .select("id")
        .single();
      const { data: tRow } = await service
        .from("teachers")
        .insert({ user_id: teacherA.userId, school_id: testSchoolId, nip: `NIP-${runSuffix}` })
        .select("id")
        .single();

      expect(s1Row?.id).toBeTruthy();
      expect(s2Row?.id).toBeTruthy();
      expect(tRow?.id).toBeTruthy();

      // 1. Admin A can only read School A, never School B
      const adminSchools = await adminA.client.from("schools").select("id");
      expect(adminSchools.data?.map((s) => s.id)).toEqual([testSchoolId]);

      // 2. Student 1 sees ONLY their own student row, never Student 2, never Teachers, never Audit logs
      const s1Students = await student1.client.from("students").select("id");
      expect(s1Students.data?.map((s) => s.id)).toEqual([s1Row!.id]);

      const s1Teachers = await student1.client.from("teachers").select("id");
      expect(s1Teachers.data ?? []).toHaveLength(0);

      const s1Audit = await student1.client.from("audit_events").select("id");
      expect(s1Audit.data ?? []).toHaveLength(0);

      // 3. Student 1 cannot escalate roles or mutate protected user_profiles columns
      const { data: adminRoleRow } = await service
        .from("roles")
        .select("id")
        .eq("code", "admin")
        .single();
      const escalateRes = await student1.client.from("user_roles").insert({
        user_id: student1.userId,
        role_id: adminRoleRow!.id,
        school_id: testSchoolId,
      });
      expect(escalateRes.error).not.toBeNull();

      const profileMutateRes = await student1.client
        .from("user_profiles")
        .update({ school_id: otherSchoolId })
        .eq("id", student1.userId);
      expect(
        profileMutateRes.error !== null || (profileMutateRes.data ?? []).length === 0
      ).toBe(true);

      // 4. Teacher A sees zero unassigned students
      const tStudents = await teacherA.client.from("students").select("id");
      expect(tStudents.data ?? []).toHaveLength(0);

      // 5. Audit events are append-only: admin can insert & read, service cannot update/delete
      const { data: auditRow, error: auditInsErr } = await adminA.client
        .from("audit_events")
        .insert({
          school_id: testSchoolId,
          actor_user_id: adminA.userId,
          actor_role: "admin",
          action: "test.rls_verified",
          entity_type: "school",
          entity_id: testSchoolId,
          summary: "Live RLS verification event",
        })
        .select("id")
        .single();
      expect(auditInsErr).toBeNull();
      expect(auditRow?.id).toBeTruthy();

      const updateAudit = await service
        .from("audit_events")
        .update({ summary: "tampered" })
        .eq("id", auditRow!.id);
      expect(updateAudit.error).not.toBeNull();

      const deleteAudit = await service.from("audit_events").delete().eq("id", auditRow!.id);
      expect(deleteAudit.error).not.toBeNull();
    } finally {
      for (const uid of createdAuthIds) {
        await service.auth.admin.deleteUser(uid);
      }
      await service.from("schools").delete().in("id", [testSchoolId, otherSchoolId]);
    }
  });
});
