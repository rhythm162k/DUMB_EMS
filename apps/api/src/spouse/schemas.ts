import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// PUT replaces the whole spouse record: an omitted optional field is stored as empty.
// strictObject rejects unknown keys (mass-assignment protection), including employeeId.
export const upsertSpouseSchema = z.strictObject({
  spouseName: z.string().trim().min(1, "Spouse name is required.").max(200),
  spouseOccupation: optionalText(150),
  spouseDateOfBirth: z.iso
    .date("Use the date format YYYY-MM-DD.")
    .nullish()
    .transform((value) => value ?? null)
    .refine(
      (value) =>
        value === null || value <= new Date().toISOString().slice(0, 10),
      "Date of birth cannot be in the future.",
    ),
  spouseNationalId: optionalText(30),
});
