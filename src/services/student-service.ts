import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor } from "@/domain/auth/types";
import { hasRole } from "@/policies/authorization";
import {
  fetchStudentPortalData,
  type StudentPortalData,
} from "@/repositories/workspace-repository";
import { ServiceError } from "@/services/errors";

export async function getStudentPortal(
  supabase: SupabaseClient,
  actor: AuthenticatedActor
): Promise<StudentPortalData> {
  if (!actor.isActive || !hasRole(actor.roles, "student")) {
    throw new ServiceError(403, "FORBIDDEN", "Akses khusus akun siswa.");
  }

  return fetchStudentPortalData(supabase, actor);
}
