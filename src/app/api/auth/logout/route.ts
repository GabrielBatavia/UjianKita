import { NextResponse } from "next/server";
import { buildAuditContext } from "@/lib/api-helpers";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/repositories/audit-repository";
import { loadAuthenticatedActor } from "@/repositories/auth-repository";

export async function POST(request: Request) {
  if (!getPublicEnvStatus().configured) {
    return NextResponse.json({ ok: true });
  }

  const supabase = await createSupabaseServerClient();
  const actor = await loadAuthenticatedActor(supabase);

  if (actor) {
    const auditCtx = buildAuditContext(request);
    await recordAuditEvent(supabase, {
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      action: "auth.logout",
      entityType: "session",
      entityId: actor.userId,
      summary: `${actor.fullName} keluar dari sistem`,
      ipAddress: auditCtx.ipAddress,
      userAgent: auditCtx.userAgent,
    });
  }

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
