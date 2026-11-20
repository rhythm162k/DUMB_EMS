import { z } from "zod";

const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "This password is too long. Please choose a shorter password with at least 12 characters.",
  );

export const loginSchema = z.object({
  employeeId: z.string().trim().min(1).max(50),
  password: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password is too long.",
    ),
});

export const firstLoginPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const employeeIdParamSchema = z.object({
  employeeId: z.string().uuid(),
});
