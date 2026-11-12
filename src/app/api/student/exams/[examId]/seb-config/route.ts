import { handleApiError } from "@/lib/api-helpers";
import {
  getPolicyReaderClient,
  resolveSafeRequestOrigin,
} from "@/lib/supabase/policy-reader";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoleActor } from "@/services/auth-service";
import { generateStudentSebConfigDownloadService } from "@/services/monitoring-service";

export async function GET(
  request: Request,
  context: { params: Promise<{ examId: string }> }
) {
  try {
    const actor = await requireRoleActor("student");
    const { examId } = await context.params;
    const supabase = await createSupabaseServerClient();
    const { filename, plistXml } = await generateStudentSebConfigDownloadService(
      supabase,
      getPolicyReaderClient(supabase),
      actor,
      examId,
      resolveSafeRequestOrigin(request)
    );

    return new Response(plistXml, {
      status: 200,
      headers: {
        "Content-Type": "application/seb; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
