import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email wajib diisi")
    .email("Format email tidak valid")
    .max(254, "Email terlalu panjang"),
  password: z
    .string()
    .min(1, "Kata sandi wajib diisi")
    .min(8, "Kata sandi minimal 8 karakter")
    .max(128, "Kata sandi maksimal 128 karakter"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email wajib diisi")
    .email("Format email tidak valid")
    .max(254, "Email terlalu panjang"),
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Kata sandi baru minimal 8 karakter")
      .max(128, "Kata sandi maksimal 128 karakter")
      .regex(/[A-Za-z]/, "Kata sandi harus mengandung minimal satu huruf")
      .regex(/[0-9]/, "Kata sandi harus mengandung minimal satu angka"),
    confirmPassword: z.string().min(1, "Konfirmasi kata sandi wajib diisi"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Konfirmasi kata sandi tidak cocok",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
