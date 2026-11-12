/**
 * UjianKita Phase 3 Reproducible Concurrency & Answer Autosave Load Test Harness
 *
 * Designed to simulate ~100 simultaneous students starting an exam, sending bursts
 * of monotonic autosave updates across questions, recovering from idempotent retries,
 * and performing atomic submission against an ISOLATED local/staging deployment.
 *
 * Usage (explicit safety guard — refuses to run against arbitrary targets):
 *   LOAD_TEST_CONFIRM_ISOLATED=true \
 *   TARGET_BASE_URL=http://127.0.0.1:3000 \
 *   LOAD_TEST_EXAM_ID=<exam-uuid> \
 *   LOAD_TEST_TOKENS_JSON='[{"cookie":"..."}]' \
 *   npx tsx scripts/load-test-exam-engine.ts
 *
 * Notice: NEVER execute against production or shared databases.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";

interface VirtualStudentSession {
  cookie: string;
}

interface LatencyMetric {
  phase: "start" | "save" | "submit";
  ms: number;
  status: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx]!);
}

async function runVirtualStudent(params: {
  baseUrl: string;
  examId: string;
  session: VirtualStudentSession;
  questionsPerStudent: number;
  metrics: LatencyMetric[];
}): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  const headers = {
    "Content-Type": "application/json",
    Cookie: params.session.cookie,
  };

  // 1. Staggered start request (with jitter simulating real bell ring)
  await new Promise((r) => setTimeout(r, Math.random() * 1200));

  const startBegin = performance.now();
  const startRes = await fetch(`${params.baseUrl}/api/student/exams/${params.examId}/start`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      startIdempotencyKey: randomUUID(),
      clientTimezone: "Asia/Jakarta",
    }),
  });
  params.metrics.push({
    phase: "start",
    ms: performance.now() - startBegin,
    status: startRes.status,
  });

  if (!startRes.ok) {
    errors.push(`Start failed (${startRes.status})`);
    return { ok: false, errors };
  }

  const startData = (await startRes.json()) as { attemptId: string };
  const attemptId = startData.attemptId;

  const workspaceRes = await fetch(`${params.baseUrl}/api/student/attempts/${attemptId}`, {
    headers: { Cookie: params.session.cookie },
  });
  if (!workspaceRes.ok) {
    errors.push(`Workspace load failed (${workspaceRes.status})`);
    return { ok: false, errors };
  }
  const workspace = (await workspaceRes.json()) as {
    questions: Array<{
      attemptQuestionId: string;
      questionType: "single_choice" | "multiple_choice" | "true_false" | "essay";
      options: Array<{ optionKey: string }>;
    }>;
  };

  // 2. Autosave loop across questions (plus duplicate retry check on first question)
  const targetQuestions = workspace.questions.slice(0, params.questionsPerStudent);
  for (let i = 0; i < targetQuestions.length; i += 1) {
    const q = targetQuestions[i]!;
    const payload =
      q.questionType === "essay"
        ? { questionType: "essay", textAnswer: `Jawaban simulasi beban butir ${i + 1}` }
        : q.questionType === "multiple_choice"
          ? {
              questionType: "multiple_choice",
              selectedOptionKeys: q.options[0] ? [q.options[0].optionKey] : [],
            }
          : {
              questionType: q.questionType,
              selectedOptionKey: q.options[0]?.optionKey ?? null,
            };

    const idemKey = randomUUID();
    const saveBegin = performance.now();
    const saveRes = await fetch(`${params.baseUrl}/api/student/attempts/${attemptId}/answers`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        attemptQuestionId: q.attemptQuestionId,
        idempotencyKey: idemKey,
        clientRevision: 1,
        responsePayload: payload,
      }),
    });
    params.metrics.push({
      phase: "save",
      ms: performance.now() - saveBegin,
      status: saveRes.status,
    });

    if (!saveRes.ok) {
      errors.push(`Save failed Q${i + 1} (${saveRes.status})`);
    }

    // Exercise idempotent retry on question 1
    if (i === 0) {
      const retryRes = await fetch(`${params.baseUrl}/api/student/attempts/${attemptId}/answers`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          attemptQuestionId: q.attemptQuestionId,
          idempotencyKey: idemKey,
          clientRevision: 1,
          responsePayload: payload,
        }),
      });
      if (!retryRes.ok) {
        errors.push(`Idempotent retry failed (${retryRes.status})`);
      }
    }
  }

  // 3. Atomic double-submit idempotency probe
  const submitKey = randomUUID();
  const submitBegin = performance.now();
  const [sub1, sub2] = await Promise.all([
    fetch(`${params.baseUrl}/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotencyKey: submitKey }),
    }),
    fetch(`${params.baseUrl}/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      headers,
      body: JSON.stringify({ idempotencyKey: submitKey }),
    }),
  ]);
  params.metrics.push({
    phase: "submit",
    ms: performance.now() - submitBegin,
    status: sub1.status,
  });

  if (!sub1.ok || !sub2.ok) {
    errors.push(`Submit concurrency failed (${sub1.status}, ${sub2.status})`);
    return { ok: false, errors };
  }

  const r1 = (await sub1.json()) as { receiptCode?: string };
  const r2 = (await sub2.json()) as { receiptCode?: string };
  if (!r1.receiptCode || r1.receiptCode !== r2.receiptCode) {
    errors.push(`Duplicate submission created divergent receipts: ${r1.receiptCode} vs ${r2.receiptCode}`);
    return { ok: false, errors };
  }

  return { ok: errors.length === 0, errors };
}

async function main() {
  if (process.env.LOAD_TEST_CONFIRM_ISOLATED !== "true") {
    console.error(
      "ABORTED: Set LOAD_TEST_CONFIRM_ISOLATED=true to confirm target environment is an isolated test instance."
    );
    process.exit(1);
  }

  const baseUrl = process.env.TARGET_BASE_URL;
  const examId = process.env.LOAD_TEST_EXAM_ID;
  const tokensRaw =
    process.env.LOAD_TEST_TOKENS_FILE && fs.existsSync(process.env.LOAD_TEST_TOKENS_FILE)
      ? fs.readFileSync(process.env.LOAD_TEST_TOKENS_FILE, "utf8")
      : process.env.LOAD_TEST_TOKENS_JSON;

  if (!baseUrl || !examId || !tokensRaw) {
    console.error(
      "Missing TARGET_BASE_URL, LOAD_TEST_EXAM_ID, or LOAD_TEST_TOKENS_JSON/LOAD_TEST_TOKENS_FILE environment variables."
    );
    process.exit(1);
  }

  const sessions = JSON.parse(tokensRaw) as VirtualStudentSession[];
  const metrics: LatencyMetric[] = [];
  console.log(`Starting synthetic exam load run for ${sessions.length} concurrent students...`);

  const results = await Promise.all(
    sessions.map((session) =>
      runVirtualStudent({
        baseUrl,
        examId,
        session,
        questionsPerStudent: 10,
        metrics,
      })
    )
  );

  for (const phase of ["start", "save", "submit"] as const) {
    const times = metrics
      .filter((m) => m.phase === phase)
      .map((m) => m.ms)
      .sort((a, b) => a - b);
    const failed = metrics.filter((m) => m.phase === phase && m.status >= 400).length;
    console.log(
      `[${phase.toUpperCase()}] count=${times.length} errors=${failed} p50=${percentile(
        times,
        50
      )}ms p95=${percentile(times, 95)}ms p99=${percentile(times, 99)}ms`
    );
  }

  const totalFailedStudents = results.filter((r) => !r.ok).length;
  console.log(
    `Load simulation completed: ${results.length - totalFailedStudents}/${results.length} succeeded cleanly.`
  );
  if (totalFailedStudents > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
