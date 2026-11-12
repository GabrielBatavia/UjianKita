import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockLoadAuthenticatedActor = vi.fn();
const mockRecordAuditEvent = vi.fn();
const mockSaveStudentAnswerService = vi.fn();
const mockSubmitStudentAttemptService = vi.fn();
const mockRequireRoleActor = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
    },
  }),
}));

vi.mock("@/repositories/auth-repository", () => ({
  loadAuthenticatedActor: (...args: unknown[]) => mockLoadAuthenticatedActor(...args),
}));

vi.mock("@/repositories/audit-repository", () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

vi.mock("@/services/auth-service", () => ({
  requireRoleActor: (...args: unknown[]) => mockRequireRoleActor(...args),
}));

vi.mock("@/services/attempt-service", () => ({
  saveStudentAnswerService: (...args: unknown[]) => mockSaveStudentAnswerService(...args),
  submitStudentAttemptService: (...args: unknown[]) => mockSubmitStudentAttemptService(...args),
}));

import { POST as postLogin } from "@/app/api/auth/login/route";
import { PUT as putAnswer } from "@/app/api/student/attempts/[attemptId]/answers/route";
import { POST as postSubmit } from "@/app/api/student/attempts/[attemptId]/submit/route";

const liveUrl = process.env.TEST_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveAnon = process.env.TEST_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const liveService =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const runLive = Boolean(
  liveUrl && liveAnon && liveService && process.env.RUN_LIVE_DB_TESTS === "true"
);

describe("Phase 6 School Wi-Fi NAT Login & Abusive Rate-Limiting Strategy", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    resetRateLimitForTests();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.synthetic_anon_key_for_unit_test";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    resetRateLimitForTests();
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;

    if (prevAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevAnon;

    if (prevService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevService;
  });

  it("allows 100 legitimate students sharing a single school Wi-Fi IP to log in concurrently", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    mockRecordAuditEvent.mockResolvedValue(undefined);
    mockLoadAuthenticatedActor.mockImplementation(async () => ({
      userId: randomUUID(),
      schoolId: randomUUID(),
      fullName: "Siswa Ujian",
      primaryRole: "student",
      roles: ["student"],
    }));

    const schoolWifiIp = "203.0.113.50";
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, idx) => {
        const req = new NextRequest("https://staging.ujiankita.test/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": schoolWifiIp,
          },
          body: JSON.stringify({
            email: `siswa-${idx + 1}@sman1.sch.id`,
            password: "ValidPassword123!",
          }),
        });
        return postLogin(req);
      })
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("blocks single-account brute force after 8 failed password attempts while returning Retry-After", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const targetEmail = "guru@sman1.sch.id";
    for (let i = 1; i <= 8; i++) {
      const req = new NextRequest("https://staging.ujiankita.test/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `198.51.100.${i}`,
        },
        body: JSON.stringify({
          email: targetEmail,
          password: `WrongPass${i}!`,
        }),
      });
      const res = await postLogin(req);
      expect(res.status).toBe(401);
    }

    const blockedReq = new NextRequest("https://staging.ujiankita.test/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "198.51.100.99",
      },
      body: JSON.stringify({
        email: targetEmail,
        password: "WrongPass9!",
      }),
    });
    const blockedRes = await postLogin(blockedReq);
    expect(blockedRes.status).toBe(429);
    expect(Number(blockedRes.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("blocks credential stuffing (many failed emails from one IP) without blocking answer saves or submission", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });

    const attackerIp = "198.51.100.77";
    for (let i = 1; i <= 25; i++) {
      const req = new NextRequest("https://staging.ujiankita.test/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": attackerIp,
        },
        body: JSON.stringify({
          email: `spray-${i}@sman1.sch.id`,
          password: "BadPassword123!",
        }),
      });
      const res = await postLogin(req);
      expect(res.status).toBe(401);
    }

    const blockedStuffingReq = new NextRequest("https://staging.ujiankita.test/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": attackerIp,
      },
      body: JSON.stringify({
        email: "spray-26@sman1.sch.id",
        password: "BadPassword123!",
      }),
    });
    const blockedStuffingRes = await postLogin(blockedStuffingReq);
    expect(blockedStuffingRes.status).toBe(429);

    // Verify already-authenticated student exam save and submission behind the same IP remain unaffected
    const studentActor = {
      userId: randomUUID(),
      schoolId: randomUUID(),
      fullName: "Siswa Ujian",
      primaryRole: "student",
      roles: ["student"],
    };
    mockRequireRoleActor.mockResolvedValue(studentActor);
    mockSaveStudentAnswerService.mockResolvedValue({
      outcome: "COMMITTED",
      attemptId: "att-1",
      attemptQuestionId: "aq-1",
      authoritativeRevision: 1,
      committedAtUtc: new Date().toISOString(),
      serverNowUtc: new Date().toISOString(),
    });
    mockSubmitStudentAttemptService.mockResolvedValue({
      receiptCode: "RCP-OK-01",
      submittedAtUtc: new Date().toISOString(),
    });

    const saveReq = new NextRequest("https://staging.ujiankita.test/api/student/attempts/att-1/answers", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": attackerIp,
      },
      body: JSON.stringify({
        attemptQuestionId: "aq-1",
        idempotencyKey: randomUUID(),
        clientRevision: 1,
        responsePayload: { questionType: "single_choice", selectedOptionKey: "A" },
      }),
    });
    const saveRes = await putAnswer(saveReq, { params: Promise.resolve({ attemptId: "att-1" }) });
    expect(saveRes.status).toBe(200);

    const subReq = new NextRequest("https://staging.ujiankita.test/api/student/attempts/att-1/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": attackerIp,
      },
      body: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    const subRes = await postSubmit(subReq, { params: Promise.resolve({ attemptId: "att-1" }) });
    expect(subRes.status).toBe(200);
  });
});

describe.skipIf(!runLive)(
  "Phase 6 Live PostgreSQL Distributed Rate-Limiter Store & Security Boundaries",
  () => {
    it("denies anon access and atomically enforces cross-lambda concurrency limits via consume_rate_limit", async () => {
      const anonClient = createClient(liveUrl!, liveAnon!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const serviceClient = createClient(liveUrl!, liveService!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const testBucket = `test:phase6:concurrent:${randomUUID()}`;

      // 1. Anon client cannot read table or invoke service-role RPC
      const anonTableRes = await anonClient.from("api_rate_limits").select("*").limit(1);
      expect(anonTableRes.error).not.toBeNull();

      const anonRpcRes = await anonClient.rpc("consume_rate_limit", {
        p_bucket_key: testBucket,
        p_limit: 5,
        p_window_ms: 60_000,
        p_increment: true,
      });
      expect(anonRpcRes.error).not.toBeNull();

      // 2. Concurrent bursts across independent calls share exact PostgreSQL lock/counter
      try {
        const calls = await Promise.all(
          Array.from({ length: 10 }, () =>
            serviceClient.rpc("consume_rate_limit", {
              p_bucket_key: testBucket,
              p_limit: 5,
              p_window_ms: 60_000,
              p_increment: true,
            })
          )
        );
        const allowedCount = calls.filter((c) => {
          const row = Array.isArray(c.data) ? c.data[0] : c.data;
          return row?.allowed === true;
        }).length;
        const rejectedCount = calls.filter((c) => {
          const row = Array.isArray(c.data) ? c.data[0] : c.data;
          return row?.allowed === false;
        }).length;

        expect(allowedCount).toBe(5);
        expect(rejectedCount).toBe(5);
      } finally {
        await serviceClient.rpc("reset_rate_limit_bucket", { p_bucket_key: testBucket });
      }
    });
  }
);
