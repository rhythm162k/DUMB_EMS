import { z } from "zod";
import {
  ACCOUNT_STATUSES,
  BLOOD_GROUPS,
  EMPLOYMENT_STATUSES,
  GENDERS,
  MARITAL_STATUSES,
} from "./constants.js";

// Optional text: trims, turns "", null and undefined into null.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const todayIso = () => new Date().toISOString().slice(0, 10);

const optionalDate = z.iso
  .date("Use the date format YYYY-MM-DD.")
  .nullish()
  .transform((value) => value ?? null);

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email("Enter a valid email address."))
  .nullish()
  .transform((value) => value ?? null);

const optionalPhone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{6,30}$/, "Enter a valid phone number.")
  .nullish()
  .transform((value) => value ?? null);

// strictObject rejects unknown keys, which blocks mass assignment
// (for example a client trying to send `role` or `accountStatus`).
export const createEmployeeSchema = z.strictObject({
  officialEmployeeId: z
    .string()
    .trim()
    .min(1, "Employee ID is required.")
    .max(50)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9-]*$/,
      "Employee ID may contain only letters, digits and hyphens.",
    ),
  firstNameEn: z.string().trim().min(1, "First name is required.").max(100),
  lastNameEn: optionalText(100),
  fullNameBn: optionalText(200),
  departmentId: z.string().uuid("Select a valid department."),
  gender: z.enum(GENDERS),
  bloodGroup: z.enum(BLOOD_GROUPS),
  dateOfBirth: optionalDate.refine(
    (value) => value === null || value <= todayIso(),
    "Date of birth cannot be in the future.",
  ),
  designation: optionalText(150),
  joiningDate: optionalDate,
  nationalId: optionalText(30),
  phone: optionalPhone,
  email: optionalEmail,
  fatherName: optionalText(200),
  motherName: optionalText(200),
  religion: optionalText(50),
  maritalStatus: z
    .enum(MARITAL_STATUSES)
    .nullish()
    .transform((value) => value ?? null),
});

export const employeeListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: z.string().uuid().optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateStatusSchema = z
  .strictObject({
    employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
    accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (value) =>
      value.employmentStatus !== undefined || value.accountStatus !== undefined,
    {
      message: "Provide employmentStatus, accountStatus or both.",
    },
  );

// ---- Admin direct edit (PATCH /admin/employees/:employeeId) ----
// Absent key = leave unchanged. Optional text fields accept null or "" to clear them.
// The official employee ID is deliberately not part of this schema: it is immutable and
// the route rejects any attempt to send it before this schema is applied.
const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const PHONE_PATTERN = /^[0-9+\-\s()]{6,30}$/;

export const updateEmployeeSchema = z
  .strictObject({
    firstNameEn: z
      .string()
      .trim()
      .min(1, "First name cannot be empty.")
      .max(100)
      .optional(),
    lastNameEn: nullableText(100),
    fullNameBn: nullableText(200),
    departmentId: z.string().uuid("Select a valid department.").optional(),
    gender: z.enum(GENDERS).optional(),
    bloodGroup: z.enum(BLOOD_GROUPS).optional(),
    dateOfBirth: z.iso
      .date("Use the date format YYYY-MM-DD.")
      .nullable()
      .optional()
      .refine(
        (value) => value == null || value <= todayIso(),
        "Date of birth cannot be in the future.",
      ),
    joiningDate: z.iso
      .date("Use the date format YYYY-MM-DD.")
      .nullable()
      .optional(),
    nationalId: nullableText(30),
    phone: z
      .string()
      .trim()
      .max(30)
      .nullable()
      .optional()
      .refine(
        (value) => value == null || value === "" || PHONE_PATTERN.test(value),
        "Enter a valid phone number.",
      ),
    email: z
      .string()
      .trim()
      .max(254)
      .nullable()
      .optional()
      .refine(
        (value) =>
          value == null || value === "" || z.email().safeParse(value).success,
        "Enter a valid email address.",
      ),
    presentAddress: nullableText(1000),
    permanentAddress: nullableText(1000),
    designation: nullableText(150),
    fatherName: nullableText(200),
    motherName: nullableText(200),
    religion: nullableText(50),
    maritalStatus: z.enum(MARITAL_STATUSES).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "Provide at least one field to update.",
    },
  );
