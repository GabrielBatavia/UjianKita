import { buildSecurityReportCsv } from "@/domain/monitoring/presence-and-incidents";
import { buildAuditContext, handleApiError, noStoreJson } from "@/lib/api-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermissionActor } from "@/services/auth-service";
import { buildExamSecurityReportService } from "@/services/monitoring-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requirePermissionActor("monitoring.reports.export");
    const { examId } = await context.params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";

    const supabase = await createSupabaseServerClient();
    const report = await buildExamSecurityReportService(
      supabase,
      actor,
      examId,
      buildAuditContext(request)
    );

    if (format === "csv") {
      const csv = buildSecurityReportCsv(report);
      return new Response(`\uFEFF${csv}`, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="laporan-keamanan-${examId.slice(0, 8)}.csv"`,
          "Cache-Control": "no-store, no-cache, must-revalidate, private",
        },
      });
    }

    return noStoreJson(report);
  } catch (error) {
    return handleApiError(error);
  }
}
