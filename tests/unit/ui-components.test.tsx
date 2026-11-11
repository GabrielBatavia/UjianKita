import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/features/auth/login-form";
import { getNavItemsForRole } from "@/components/layout/portal-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/login",
}));

describe("LoginForm & Portal navigation UI", () => {
  it("shows honest warning and disables submit when Supabase is unconfigured", () => {
    render(<LoginForm supabaseConfigured={false} nextPath={null} initialReason={null} />);
    expect(screen.getByText(/Konfigurasi Autentikasi Belum Aktif/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Masuk ke UjianKita/i })).toBeDisabled();
  });

  it("validates email client-side before sending requests", () => {
    render(<LoginForm supabaseConfigured={true} nextPath={null} initialReason={null} />);
    fireEvent.change(screen.getByLabelText(/^Email Sekolah$/i), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText(/^Kata Sandi$/i), { target: { value: "Password123" } });
    fireEvent.submit(screen.getByRole("button", { name: /Masuk ke UjianKita/i }).closest("form")!);

    expect(screen.getByText(/Format email tidak valid/i)).toBeInTheDocument();
  });

  it("builds role-specific navigation menus accurately", () => {
    const adminNav = getNavItemsForRole("admin");
    expect(adminNav.some((i) => i.href === "/admin/students")).toBe(true);
    expect(adminNav.some((i) => i.href === "/student")).toBe(false);

    const teacherNav = getNavItemsForRole("teacher");
    expect(teacherNav.some((i) => i.href === "/teacher/questions")).toBe(true);
    expect(teacherNav.some((i) => i.href === "/teacher/exams")).toBe(true);
    expect(teacherNav.some((i) => i.href === "/teacher/schedules")).toBe(true);

    const studentNav = getNavItemsForRole("student");
    expect(studentNav.some((i) => i.href === "/student/profile")).toBe(true);
    expect(studentNav.some((i) => i.href === "/admin")).toBe(false);
  });
});
