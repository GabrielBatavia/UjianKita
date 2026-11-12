/**
 * Phase 4/5 Load & Concurrency Simulation Script for 100 Simultaneous Students
 * + Heartbeats + Batched Monitoring Events + Concurrent Answer Saves.
 *
 * SAFETY GUARD: Requires BOTH `LOAD_TEST_BASE_URL` and
 * `LOAD_TEST_CONFIRM_ISOLATED=true` so it can NEVER target production traffic
 * accidentally. Also supports `--dry-run` (default when env not set).
 * When executing live HTTP load (`!dryRun`), provide `LOAD_TEST_SESSIONS_JSON`
 * (array of `{ cookie, attemptId, attemptQuestionId, selectedOptionKey? }`)
 * or fallback `LOAD_TEST_COOKIE` + `LOAD_TEST_ATTEMPT_ID` + `LOAD_TEST_QUESTION_ID`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";

interface LoadSessionTarget {
  cookie: string;
  attemptId: string;
  attemptQuestionId: string;
  selectedOptionKey?: string;
}

interface LoadScenarioConfig {
  studentCount: number;
  baseUrl: string;
  dryRun: boolean;
  sessions: LoadSessionTarget[];
}

interface SimulatedStudentResult {
  studentIndex: number;
  heartbeatMs: number;
  eventsMs: number;
  answerSaveMs: number;
  heartbeatStatus: number;
  eventsStatus: number;
  answerSaveStatus: number;
  ok: boolean;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number((sorted[idx] ?? 0).toFixed(2));
}

async function runStudentWave(
  studentIndex: number,
  cfg: LoadScenarioConfig
): Promise<SimulatedStudentResult> {
  if (cfg.dryRun) {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 2 + (studentIndex % 7)));
    const t1 = performance.now();
    return {
      studentIndex,
      heartbeatMs: t1 - t0,
      eventsMs: 1.5,
      answerSaveMs: 2.5,
      heartbeatStatus: 200,
      eventsStatus: 200,
      answerSaveStatus: 200,
      ok: true,
    };
  }

  const target = cfg.sessions[studentIndex - 1];
  if (!target) {
    return {
      studentIndex,
      heartbeatMs: 0,
      eventsMs: 0,
      answerSaveMs: 0,
      heartbeatStatus: 0,
      eventsStatus: 0,
      answerSaveStatus: 0,
      ok: false,
    };
  }

  // Spread initial wave across 600ms to match realistic school classroom clock jitter
  await new Promise((r) => setTimeout(r, Math.random() * 600));

  const headers = {
    "Content-Type": "application/json",
    Cookie: target.cookie,
  };

  const tHbStart = performance.now();
  const hbRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${target.attemptId}/heartbeat`, {
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
  await hbRes.arrayBuffer();
  const tHbEnd = performance.now();

  const tEvStart = performance.now();
  const evRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${target.attemptId}/events`, {
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
  await evRes.arrayBuffer();
  const tEvEnd = performance.now();

  const tAnsStart = performance.now();
  const ansRes = await fetch(`${cfg.baseUrl}/api/student/attempts/${target.attemptId}/answers`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      attemptQuestionId: target.attemptQuestionId,
      idempotencyKey: randomUUID(),
      clientRevision: 1,
      responsePayload: {
        questionType: "single_choice",
        selectedOptionKey: target.selectedOptionKey ?? "A",
      },
    }),
  });
  await ansRes.arrayBuffer();
  const tAnsEnd = performance.now();

  return {
    studentIndex,
    heartbeatMs: tHbEnd - tHbStart,
    eventsMs: tEvEnd - tEvStart,
    answerSaveMs: tAnsEnd - tAnsStart,
    heartbeatStatus: hbRes.status,
    eventsStatus: evRes.status,
    answerSaveStatus: ansRes.status,
    ok: hbRes.ok && evRes.ok && ansRes.ok,
  };
}

async function main() {
  const confirmed = process.env.LOAD_TEST_CONFIRM_ISOLATED === "true";
  const baseUrl = (process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const dryRun = !confirmed || process.argv.includes("--dry-run");

  let sessions: LoadSessionTarget[] = [];
  if (!dryRun) {
    if (process.env.LOAD_TEST_SESSIONS_FILE && fs.existsSync(process.env.LOAD_TEST_SESSIONS_FILE)) {
      sessions = JSON.parse(
        fs.readFileSync(process.env.LOAD_TEST_SESSIONS_FILE, "utf8")
      ) as LoadSessionTarget[];
    } else if (process.env.LOAD_TEST_SESSIONS_JSON) {
      sessions = JSON.parse(process.env.LOAD_TEST_SESSIONS_JSON) as LoadSessionTarget[];
    } else if (
      process.env.LOAD_TEST_COOKIE &&
      process.env.LOAD_TEST_ATTEMPT_ID &&
      process.env.LOAD_TEST_QUESTION_ID
    ) {
      sessions = [
        {
          cookie: process.env.LOAD_TEST_COOKIE,
          attemptId: process.env.LOAD_TEST_ATTEMPT_ID,
          attemptQuestionId: process.env.LOAD_TEST_QUESTION_ID,
        },
      ];
    }

    if (sessions.length === 0) {
      throw new Error("LOAD_TEST_SESSIONS_JSON is required for isolated HTTP load testing.");
    }
    const parsed = new URL(baseUrl);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) && !baseUrl.includes("staging")) {
      throw new Error(`Safety guard blocked non-isolated host: ${parsed.hostname}`);
    }
  }

  const studentCount = dryRun
    ? Number(process.env.LOAD_TEST_STUDENTS ?? 100)
    : Number(process.env.LOAD_TEST_STUDENTS ?? sessions.length);

  const cfg: LoadScenarioConfig = { studentCount, baseUrl, dryRun, sessions };
  const startedAt = performance.now();

  const results = await Promise.all(
    Array.from({ length: studentCount }, (_, i) => runStudentWave(i + 1, cfg))
  );

  const totalMs = performance.now() - startedAt;
  const okCount = results.filter((r) => r.ok).length;
  const hbTimes = results.map((r) => r.heartbeatMs);
  const evTimes = results.map((r) => r.eventsMs);
  const ansTimes = results.map((r) => r.answerSaveMs);

  const summary = {
    mode: dryRun ? "DRY_RUN_LOCAL_HARNESS" : "ISOLATED_HTTP_LOAD",
    baseUrl,
    studentCount,
    okCount,
    failedCount: studentCount - okCount,
    totalDurationMs: Number(totalMs.toFixed(2)),
    heartbeat: {
      p50Ms: percentile(hbTimes, 50),
      p95Ms: percentile(hbTimes, 95),
      maxMs: percentile(hbTimes, 100),
    },
    eventsBatch: {
      p50Ms: percentile(evTimes, 50),
      p95Ms: percentile(evTimes, 95),
      maxMs: percentile(evTimes, 100),
    },
    answerSave: {
      p50Ms: percentile(ansTimes, 50),
      p95Ms: percentile(ansTimes, 95),
      maxMs: percentile(ansTimes, 100),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!dryRun && okCount < studentCount) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
