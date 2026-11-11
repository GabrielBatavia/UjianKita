import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedActor, RoleCode } from "@/domain/auth/types";
import { resolvePrimaryRole } from "@/policies/authorization";

interface RawProfileRow {
  id: string;
  email: string;
  full_name: string;
  school_id: string;
  is_active: boolean;
  schools:
    | {
        id: string;
        name: string;
        code: string;
        level: "SD" | "SMP" | "SMA" | "SMK" | "OTHER";
        timezone: string;
      }
    | Array<{
        id: string;
        name: string;
        code: string;
        level: "SD" | "SMP" | "SMA" | "SMK" | "OTHER";
        timezone: string;
      }>
    | null;
}

interface RawUserRoleRow {
  roles: { code: RoleCode } | Array<{ code: RoleCode }> | null;
}

export async function loadAuthenticatedActor(
  supabase: SupabaseClient
): Promise<AuthenticatedActor | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select(
      `
      id,
      email,
      full_name,
      school_id,
      is_active,
      schools:school_id (
        id,
        name,
        code,
        level,
        timezone
      )
    `
    )
    .eq("id", user.id)
    .maybeSingle<RawProfileRow>();

  if (profileError || !profile || !profile.is_active) {
    return null;
  }

  const school = Array.isArray(profile.schools) ? profile.schools[0] : profile.schools;
  if (!school) {
    return null;
  }

  // Always read authoritative roles from PostgreSQL user_roles + roles, never client metadata
  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("roles:role_id ( code )")
    .eq("user_id", user.id)
    .eq("school_id", profile.school_id)
    .returns<RawUserRoleRow[]>();

  if (rolesError || !roleRows) {
    return null;
  }

  const roles: RoleCode[] = [];
  for (const row of roleRows) {
    const roleObj = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (roleObj?.code && !roles.includes(roleObj.code)) {
      roles.push(roleObj.code);
    }
  }

  const primaryRole = resolvePrimaryRole(roles);
  if (!primaryRole) {
    return null;
  }

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    schoolId: profile.school_id,
    schoolName: school.name,
    schoolCode: school.code,
    schoolLevel: school.level,
    timezone: school.timezone,
    isActive: profile.is_active,
    roles,
    primaryRole,
  };
}
