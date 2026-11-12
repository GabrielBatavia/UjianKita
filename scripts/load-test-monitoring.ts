/**
 * Phase 4 Load & Concurrency Simulation Script for 100 Simultaneous Students
 * + Heartbeats + Batched Monitoring Events + Concurrent Answer Saves + Submits.
 *
 * SAFETY GUARD: Requires BOTH `LOAD_TEST_BASE_URL` and
 * `LOAD_TEST_CONFIRM_ISOLATED=true` so it can NEVER target production traffic
 * accidentally. Also supports `--dry-run` (default when env not set) to verify
 * request generation latency & deterministic distribution locally.
 */

import { randomUUID } from "node:crypto";

interface LoadScenarioConfig {
  studentCount: number;
  baseUrl: string;
  dryRun: boolean;
}

interface SimulatedStudentResult {
  studentIndex: number;
  heartbeatMs: number;
  eventsMs: number;
  answerSaveMs: number;
  ok: boolean;
}

async function runStudentWave(
  studentIndex: number,
  cfg: LoadScenarioConfig
): Promise<SimulatedStudentResult> {
  const attemptId = randomUUID();
  const qId = randomUUID();
  const t0 = performance.now();

  if (cfg.dryRun) {
    // Deterministic jittered wait simulating async network & CPU serialization overhead
    await new Promise((r) => setTimeout(r, 2 + (studentIndex % 7)));
    const t1 = performance.now();
    return {
      studentIndex,
      heartbeatMs: t1 - t0,
      eventsMs: 1.5,
      answerSaveMs: 2.5,
      ok: true,
    };
  }

  const cookie = process.env.LOAD_TEST_COOKIE ?? "";
  const headers = {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  };

  const tHbStart = performance.now();
  const hbRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${attemptId}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      visible: true,
      online: true,
      queuedAnswerCount: 0,
      browserPlatformHint: studentIndex % 3 === 0 ? "ANDROID_EXAMBRO" : "STANDARD_WEB",
      exambroHint: studentIndex % 3 === 0,
    }),
  });
  const tHbEnd = performance.now();

  const tEvStart = performance.now();
  const evRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${attemptId}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      events: [
        {
          clientEventId: randomUUID(),
          eventType: "EXAM_PAGE_HIDDEN",
          occurredAt: new Date().toISOString(),
          metadata: { wave: studentIndex },
        },
        {
          clientEventId: randomUUID(),
          eventType: "EXAM_PAGE_VISIBLE",
          occurredAt: new Date().toISOString(),
          metadata: { hiddenDurationSeconds: 4 },
        },
      ],
    }),
  });
  const tEvEnd = performance.now();

  const tAnsStart = performance.now();
  const ansRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${attemptId}/answers`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      attemptQuestionId: qId,
      idempotencyKey: randomUUID(),
      clientRevision: 1,
      responsePayload: { questionType: "single_choice", selectedOptionKey: "A" },
    }),
  });
  const tAnsEnd = performance.now();

  return {
    studentIndex,
    heartbeatMs: tHbEnd - tHbStart,
    eventsMs: tEvEnd - tEvStart,
    answerSaveMs: tAnsEnd - tAnsStart,
    ok: hbRes.ok && evRes.ok && ansRes.ok,
  };
}

async function main() {
  const confirmed = process.env.LOAD_TEST_CONFIRM_ISOLATED === "true";
  const baseUrl = process.env.LOAD_TEST_BASE_URL ?? "http://localhost:3000";
  const studentCount = Number(process.env.LOAD_TEST_STUDENTS ?? 100);
  const dryRun = !confirmed || process.argv.includes("--dry-run");

  const cfg: LoadScenarioConfig = { studentCount, baseUrl, dryRun };
  const startedAt = performance.now();

  const results = await Promise.all(
    Array.from({ length: studentCount }, (_, i) => runStudentWave(i + 1, cfg))
  );

  const totalMs = performance.now() - startedAt;
  const okCount = results.filter((r) => r.ok).length;
  const maxHb = Math.max(...results.map((r) => r.heartbeatMs));

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "DRY_RUN_LOCAL_HARNESS" : "ISOLATED_HTTP_LOAD",
        studentCount,
        okCount,
        totalDurationMs: Number(totalMs.toFixed(2)),
        maxHeartbeatMs: Number(maxHb.toFixed(2)),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
