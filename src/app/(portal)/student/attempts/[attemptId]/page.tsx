import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { getPolicyReaderClient } from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentAttemptWorkspaceService } from "@/services/attempt-service";
import { requireRoleActor } from "@/services/auth-service";
import { isServiceError } from "@/services/errors";
import { getStudentSecurityPolicyViewService } from "@/services/monitoring-service";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExamPlayerClient } from "@/components/features/student/exam-player-client";

export const metadata: Metadata = {
  title: "Pengerjaan Ujian",
};

export const dynamic = "force-dynamic";

export default async function StudentAttemptPlayerPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const actor = await requireRoleActor("student");
  const { attemptId } = await params;
  const supabase = await createSupabaseServerClient();
  const hdrs = await headers();
  const proto = hdrs.get("x-forwarded-proto") === "http" ? "http" : "https";
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;
  const policyReader = getPolicyReaderClient(supabase);

  let workspace: Awaited<ReturnType<typeof getStudentAttemptWorkspaceService>> | null = null;
  let securityPolicy: Awaited<ReturnType<typeof getStudentSecurityPolicyViewService>> | null = null;
  let errorMessage: string | null = null;

  try {
    workspace = await getStudentAttemptWorkspaceService(supabase, actor, attemptId, {
      policyReaderSupabase: policyReader,
      origin,
      headers: hdrs,
    });
    securityPolicy = await getStudentSecurityPolicyViewService(
      supabase,
      policyReader,
      actor,
      workspace.attempt.examId,
      origin
    );
  } catch (error) {
    errorMessage = isServiceError(error) ? error.message : "Sesi ujian tidak ditemukan.";
  }

  if (errorMessage || !workspace) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12">
        <Alert variant="danger" title="Sesi Ujian Tidak Dapat Dimuat">
          {errorMessage ?? "Sesi ujian tidak ditemukan."}
        </Alert>
        <Button asChild variant="outline">
          <Link href="/student/exams">Kembali ke Daftar Ujian</Link>
        </Button>
      </div>
    );
  }

  return (
    <ExamPlayerClient
      initialWorkspace={workspace}
      securityPolicy={securityPolicy}
      studentDisplayName={actor.fullName}
    />
  );
}
