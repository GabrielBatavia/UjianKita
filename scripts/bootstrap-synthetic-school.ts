/**
 * Non-production synthetic bootstrap utility for UjianKita Phase 1.5 verification.
 * Reads Supabase credentials from environment variables and creates synthetic
 * test accounts (admin, teacher, student) in an isolated synthetic school.
 * NEVER run with real student data or commit passwords to Git.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SYNTHETIC_SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const SYNTHETIC_YEAR_ID = "22222222-2222-4222-8222-222222222222";

async function ensureAuthUser(email: string, password: string, fullName: string): Promise<string> {
  const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = listData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    throw new Error(`Failed creating user ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function main() {
  const bootstrapPassword =
    process.env.SYNTHETIC_BOOTSTRAP_PASSWORD || `UjianKita#${randomBytes(6).toString("hex")}`;

  // 1. Ensure synthetic school and academic year
  const { error: schoolErr } = await admin.from("schools").upsert(
    {
      id: SYNTHETIC_SCHOOL_ID,
      code: "SMAN1-SIMULASI",
      name: "SMA Negeri 1 Simulasi",
      npsn: "20100001",
      level: "SMA",
      timezone: "Asia/Jakarta",
    },
    { onConflict: "code" }
  );
  if (schoolErr) throw schoolErr;

  const { error: yearErr } = await admin.from("academic_years").upsert(
    {
      id: SYNTHETIC_YEAR_ID,
      school_id: SYNTHETIC_SCHOOL_ID,
      name: "2026/2027",
      semester: "Ganjil",
      starts_on: "2026-07-13",
      ends_on: "2026-12-18",
      is_active: true,
    },
    { onConflict: "school_id,name,semester" }
  );
  if (yearErr) throw yearErr;

  // 2. Role IDs
  const { data: roles } = await admin.from("roles").select("id, code");
  const roleIdByCode = new Map((roles ?? []).map((r) => [r.code as string, r.id as string]));

  const accounts = [
    {
      role: "admin",
      email: "admin.simulasi@ujiankita.local",
      fullName: "Admin Simulasi UjianKita",
    },
    {
      role: "teacher",
      email: "guru.simulasi@ujiankita.local",
      fullName: "Guru Simulasi Matematika",
    },
    {
      role: "student",
      email: "siswa.simulasi@ujiankita.local",
      fullName: "Siswa Simulasi Pertama",
    },
  ] as const;

  for (const acc of accounts) {
    const userId = await ensureAuthUser(acc.email, bootstrapPassword, acc.fullName);

    await admin.from("user_profiles").upsert(
      {
        id: userId,
        school_id: SYNTHETIC_SCHOOL_ID,
        full_name: acc.fullName,
        email: acc.email,
        is_active: true,
      },
      { onConflict: "id" }
    );

    const roleId = roleIdByCode.get(acc.role);
    if (!roleId) throw new Error(`Missing role ${acc.role}`);

    await admin.from("user_roles").upsert(
      {
        user_id: userId,
        role_id: roleId,
        school_id: SYNTHETIC_SCHOOL_ID,
      },
      { onConflict: "user_id,role_id,school_id" }
    );

    if (acc.role === "teacher") {
      await admin.from("teachers").upsert(
        {
          user_id: userId,
          school_id: SYNTHETIC_SCHOOL_ID,
          nip: "198501012010011001",
          specialization: "Matematika",
          employment_status: "GTY",
        },
        { onConflict: "user_id" }
      );
    }

    if (acc.role === "student") {
      await admin.from("students").upsert(
        {
          user_id: userId,
          school_id: SYNTHETIC_SCHOOL_ID,
          nis: "20260001",
          nisn: "0099990001",
          gender: "L",
        },
        { onConflict: "user_id" }
      );
    }
  }

  console.log("Synthetic school and test accounts verified successfully.");
  if (!process.env.SYNTHETIC_BOOTSTRAP_PASSWORD) {
    console.log("Generated temporary synthetic password (not persisted):", bootstrapPassword);
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
