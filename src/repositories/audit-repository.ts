import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEventInput, AuditEventRecord } from "@/domain/audit/types";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function recordAuditEvent(
  supabase: SupabaseClient,
  input: AuditEventInput
): Promise<void> {
  const payload = {
    school_id: input.schoolId,
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    metadata: input.metadata ?? {},
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
  };

  // Prefer authenticated client when actorUserId is present so RLS actor policy applies;
  // fall back to service role for pre-auth or system-initiated events when configured.
  const clientToUse =
    input.actorUserId === null && getPublicEnvStatus().serviceRoleConfigured
      ? createSupabaseAdminClient()
      : supabase;

  const { error } = await clientToUse.from("audit_events").insert(payload);

  if (error) {
    // Log structured error without secrets; never silently crash non-blocking auth audit
    console.error("[audit_events] failed to insert audit log:", {
      action: input.action,
      code: error.code,
    });
  }
}

export async function fetchSchoolAuditEvents(
  supabase: SupabaseClient,
  schoolId: string,
  limit = 50
): Promise<AuditEventRecord[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select(
      `
      id,
      school_id,
      actor_user_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      summary,
      metadata,
      ip_address,
      user_agent,
      created_at,
      actor:actor_user_id (
        full_name
      )
    `
    )
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    throw new Error(`Gagal memuat log audit: ${error?.message ?? "unknown error"}`);
  }

  return data.map((row) => {
    const actorRel = Array.isArray(row.actor) ? row.actor[0] : row.actor;
    return {
      id: row.id as string,
      school_id: row.school_id as string,
      actor_user_id: (row.actor_user_id as string | null) ?? null,
      actor_role: row.actor_role as string,
      actor_name: (actorRel as { full_name?: string } | null)?.full_name ?? null,
      action: row.action as string,
      entity_type: row.entity_type as string,
      entity_id: (row.entity_id as string | null) ?? null,
      summary: row.summary as string,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      ip_address: (row.ip_address as string | null) ?? null,
      user_agent: (row.user_agent as string | null) ?? null,
      created_at: row.created_at as string,
    };
  });
}
