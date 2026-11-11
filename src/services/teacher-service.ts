import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import { hasRole } from "@/policies/authorization";
import {
  fetchTeacherWorkspaceData,
  type TeacherWorkspaceData,
} from "@/repositories/workspace-repository";
import { ServiceError } from "@/services/errors";

export async function getTeacherWorkspace(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<TeacherWorkspaceData> {
  if (!actor.isActive || !hasRole(actor.roles, "teacher")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus akun guru.");
  }

  return fetchTeacherWorkspaceData(supabase, actor);
}
