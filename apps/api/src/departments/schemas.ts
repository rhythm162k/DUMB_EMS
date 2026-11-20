import { z } from "zod";

export const departmentIdParamSchema = z.object({
  departmentId: z.string().uuid(),
});

// strictObject rejects unknown keys (mass-assignment protection).
export const createDepartmentSchema = z.strictObject({
  nameEn: z.string().trim().min(1, "English name is required.").max(150),
  nameBn: z
    .string()
    .trim()
    .max(150)
    .nullish()
    .transform((value) => (value ? value : null)),
});

// Absent key = unchanged. nameBn may be set to null/"" to clear it.
export const updateDepartmentSchema = z
  .strictObject({
    nameEn: z
      .string()
      .trim()
      .min(1, "English name cannot be empty.")
      .max(150)
      .optional(),
    nameBn: z.string().trim().max(150).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "Provide at least one field to update.",
    },
  );
