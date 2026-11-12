import type {
  AuthenticatedActor,
  PermissionCode,
  Phase1RoleCode,
} from "@/domain/auth/types";
import { getPublicEnvStatus } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasPermission, hasRole } from "@/policies/authorization";
import { loadAuthenticatedActor } from "@/repositories/auth-repository";
import { ServiceError } from "@/services/errors";

export async function getCurrentActor(): Promise<AuthenticatedActor | null> {
  const envStatus = getPublicEnvStatus();
  if (!envStatus.configured) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  return loadAuthenticatedActor(supabase);
}

export async function requireAuthenticatedActor(): Promise<AuthenticatedActor> {
  const envStatus = getPublicEnvStatus();
  if (!envStatus.configured) {
    throw new ServiceError(503, "SUPABASE_UNCONFIGURED", "Konfigurasi autentikasi server belum siap.");
  }

  const supabase = await createSupabaseServerClient();
  const actor = await loadAuthenticatedActor(supabase);

  if (!actor) {
    throw new ServiceError(401, "UNAUTHORIZED", "Anda harus masuk terlebih dahulu.");
  }

  return actor;
}

export async function requireRoleActor(role: Phase1RoleCode): Promise<AuthenticatedActor> {
  const actor = await requireAuthenticatedActor();
  if (!hasRole(actor.roles, role)) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk mengakses sumber daya ini.");
  }
  return actor;
}

export async function requireAnyRoleActor(
  roles: readonly Phase1RoleCode[]
): Promise<AuthenticatedActor> {
  const actor = await requireAuthenticatedActor();
  if (!roles.some((r) => hasRole(actor.roles, r))) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk mengakses sumber daya ini.");
  }
  return actor;
}

export async function requirePermissionActor(
  permission: PermissionCode
): Promise<AuthenticatedActor> {
  const actor = await requireAuthenticatedActor();
  if (!actor.isActive || !hasPermission(actor.roles, permission)) {
    throw new ServiceError(403, "FORBIDDEN", "Anda tidak memiliki izin untuk melakukan tindakan ini.");
  }
  return actor;
}
