import { describe, expect, it } from "vitest";
import { loginSchema, resetPasswordSchema } from "@/schemas/auth";
import {
  createAcademicYearSchema,
  createStudentSchema,
  createSubjectSchema,
  updateSchoolSettingsSchema,
} from "@/schemas/academic";

describe("Authentication validation schemas", () => {
  it("accepts valid login credentials and trims email", () => {
    const result = loginSchema.safeParse({
      email: "  guru@sman1.sch.id ",
      password: "Password123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("guru@sman1.sch.id");
    }
  });

  it("rejects malformed emails and short passwords", () => {
    expect(loginSchema.safeParse({ email: "bukan-email", password: "Password123" }).success).toBe(
      false
    );
    expect(loginSchema.safeParse({ email: "a@b.id", password: "123" }).success).toBe(false);
  });

  it("enforces password complexity and confirmation matching on reset", () => {
    expect(
      resetPasswordSchema.safeParse({
        password: "onlyletters",
        confirmPassword: "onlyletters",
      }).success
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        password: "Password123",
        confirmPassword: "Password124",
      }).success
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        password: "Password123",
        confirmPassword: "Password123",
      }).success
    ).toBe(true);
  });
});

describe("Academic validation schemas", () => {
  it("validates student NIS and 10-digit NISN", () => {
    const valid = createStudentSchema.safeParse({
      fullName: "Budi Santoso",
      email: "budi@siswa.sch.id",
      initialPassword: "Password123",
      nis: "2026001",
      nisn: "0091234567",
      gender: "L",
    });
    expect(valid.success).toBe(true);

    const badNisn = createStudentSchema.safeParse({
      fullName: "Budi Santoso",
      email: "budi@siswa.sch.id",
      initialPassword: "Password123",
      nis: "2026001",
      nisn: "12345",
    });
    expect(badNisn.success).toBe(false);
  });

  it("ensures academic year end date is strictly after start date", () => {
    expect(
      createAcademicYearSchema.safeParse({
        name: "2026/2027",
        semester: "Ganjil",
        startsOn: "2026-12-18",
        endsOn: "2026-07-13",
        isActive: true,
      }).success
    ).toBe(false);

    expect(
      createAcademicYearSchema.safeParse({
        name: "2026/2027",
        semester: "Ganjil",
        startsOn: "2026-07-13",
        endsOn: "2026-12-18",
        isActive: true,
      }).success
    ).toBe(true);
  });

  it("normalizes subject code to uppercase and rejects spaces", () => {
    const ok = createSubjectSchema.safeParse({
      code: "mat-10",
      name: "Matematika",
      curriculumGroup: "Wajib",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.code).toBe("MAT-10");
    }

    expect(
      createSubjectSchema.safeParse({
        code: "MAT 10",
        name: "Matematika",
      }).success
    ).toBe(false);
  });

  it("validates 8-digit NPSN and Indonesian timezones in school settings", () => {
    const badNpsn = updateSchoolSettingsSchema.safeParse({
      name: "SMA Negeri 1 Simulasi",
      npsn: "123",
      level: "SMA",
      timezone: "Asia/Jakarta",
      resultReleasePolicy: "manual_review",
      requireExamBrowserInHighStakes: true,
      allowLateJoinMinutes: 15,
      heartbeatIntervalSeconds: 20,
    });
    expect(badNpsn.success).toBe(false);

    const ok = updateSchoolSettingsSchema.safeParse({
      name: "SMA Negeri 1 Simulasi",
      npsn: "20100001",
      level: "SMA",
      timezone: "Asia/Makassar",
      resultReleasePolicy: "manual_review",
      requireExamBrowserInHighStakes: true,
      allowLateJoinMinutes: 15,
      heartbeatIntervalSeconds: 20,
    });
    expect(ok.success).toBe(true);
  });
});
