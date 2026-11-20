// Employment status describes the person's relationship with the office.
// Account status describes whether the login account may be used.
// They are intentionally separate (see blueprint section 4.5).
export const EMPLOYMENT_STATUSES = [
  "ACTIVE",
  "TRANSFERRED_OUT",
  "RETIRED",
  "RESIGNED",
  "SUSPENDED",
  "DECEASED",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "DISABLED", "LOCKED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const MARITAL_STATUSES = [
  "SINGLE",
  "MARRIED",
  "DIVORCED",
  "WIDOWED",
] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;
