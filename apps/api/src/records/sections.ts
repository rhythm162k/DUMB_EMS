import { z } from "zod";

// Static registry of the repeatable PDS sections. The URL slug, table and column names come
// from this file only; nothing from the client is ever used as an SQL identifier.
export type RecordField = { key: string; column: string; isDate?: boolean };

export type RecordSection = {
  slug: string;
  table: string;
  // Key used for this section in the employee detail / own-profile `records` object.
  responseKey: string;
  fields: readonly RecordField[];
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  // Field keys of a start/end pair that must be in order (end on or after start).
  dateRange?: { start: string; end: string };
  orderBy: string;
};

const requiredText = (max: number) =>
  z.string().trim().min(1, "This field is required.").max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();
const optionalDate = z.iso
  .date("Use the date format YYYY-MM-DD.")
  .nullable()
  .optional();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Only http(s) links are accepted so a stored value can never be a javascript: URL.
const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .refine(
    (value) => value == null || value === "" || isHttpUrl(value),
    "Enter a valid http or https URL.",
  );

const hasAnyValue = (value: object) =>
  Object.values(value).some((entry) => entry !== undefined);
const atLeastOne = { message: "Provide at least one field to update." };

// strictObject rejects unknown keys, so employeeId, id or timestamps cannot be mass-assigned.
const qualificationBase = z.strictObject({
  institution: requiredText(200),
  degree: requiredText(150),
  subject: optionalText(150),
  passingYear: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .nullable()
    .optional(),
  result: optionalText(100),
});

const trainingBase = z.strictObject({
  title: requiredText(200),
  provider: optionalText(200),
  location: optionalText(200),
  startDate: optionalDate,
  endDate: optionalDate,
  remarks: optionalText(2000),
});

const serviceBase = z.strictObject({
  organization: requiredText(200),
  designation: requiredText(150),
  startDate: optionalDate,
  endDate: optionalDate,
  description: optionalText(2000),
});

const postingBase = z.strictObject({
  departmentId: z
    .string()
    .uuid("Select a valid department.")
    .nullable()
    .optional(),
  officeName: optionalText(200),
  designation: optionalText(150),
  startDate: optionalDate,
  endDate: optionalDate,
  orderReference: optionalText(100),
});

const membershipBase = z.strictObject({
  organization: requiredText(200),
  membershipNumber: optionalText(100),
  membershipType: optionalText(100),
  startDate: optionalDate,
  endDate: optionalDate,
});

const publicationBase = z.strictObject({
  title: requiredText(300),
  publicationName: optionalText(200),
  publicationDate: optionalDate,
  referenceUrl: optionalUrl,
});

export const RECORD_SECTIONS: readonly RecordSection[] = [
  {
    slug: "qualifications",
    table: "academic_qualifications",
    responseKey: "academicQualifications",
    fields: [
      { key: "institution", column: "institution" },
      { key: "degree", column: "degree" },
      { key: "subject", column: "subject" },
      { key: "passingYear", column: "passing_year" },
      { key: "result", column: "result" },
    ],
    createSchema: qualificationBase,
    updateSchema: qualificationBase.partial().refine(hasAnyValue, atLeastOne),
    orderBy: "passing_year DESC NULLS LAST, created_at ASC",
  },
  {
    slug: "training",
    table: "training_records",
    responseKey: "trainingRecords",
    fields: [
      { key: "title", column: "title" },
      { key: "provider", column: "provider" },
      { key: "location", column: "location" },
      { key: "startDate", column: "start_date", isDate: true },
      { key: "endDate", column: "end_date", isDate: true },
      { key: "remarks", column: "remarks" },
    ],
    createSchema: trainingBase,
    updateSchema: trainingBase.partial().refine(hasAnyValue, atLeastOne),
    dateRange: { start: "startDate", end: "endDate" },
    orderBy: "start_date DESC NULLS LAST, created_at ASC",
  },
  {
    slug: "service-history",
    table: "service_history",
    responseKey: "serviceHistory",
    fields: [
      { key: "organization", column: "organization" },
      { key: "designation", column: "designation" },
      { key: "startDate", column: "start_date", isDate: true },
      { key: "endDate", column: "end_date", isDate: true },
      { key: "description", column: "description" },
    ],
    createSchema: serviceBase,
    updateSchema: serviceBase.partial().refine(hasAnyValue, atLeastOne),
    dateRange: { start: "startDate", end: "endDate" },
    orderBy: "start_date DESC NULLS LAST, created_at ASC",
  },
  {
    slug: "posting-history",
    table: "posting_history",
    responseKey: "postingHistory",
    fields: [
      { key: "departmentId", column: "department_id" },
      { key: "officeName", column: "office_name" },
      { key: "designation", column: "designation" },
      { key: "startDate", column: "start_date", isDate: true },
      { key: "endDate", column: "end_date", isDate: true },
      { key: "orderReference", column: "order_reference" },
    ],
    // Every column is optional in the table, so a new posting must name at least one thing.
    createSchema: postingBase.refine(
      (value) =>
        Boolean(value.departmentId || value.officeName || value.designation),
      { message: "Provide a department, office name or designation." },
    ),
    updateSchema: postingBase.partial().refine(hasAnyValue, atLeastOne),
    dateRange: { start: "startDate", end: "endDate" },
    orderBy: "start_date DESC NULLS LAST, created_at ASC",
  },
  {
    slug: "memberships",
    table: "professional_memberships",
    responseKey: "professionalMemberships",
    fields: [
      { key: "organization", column: "organization" },
      { key: "membershipNumber", column: "membership_number" },
      { key: "membershipType", column: "membership_type" },
      { key: "startDate", column: "start_date", isDate: true },
      { key: "endDate", column: "end_date", isDate: true },
    ],
    createSchema: membershipBase,
    updateSchema: membershipBase.partial().refine(hasAnyValue, atLeastOne),
    dateRange: { start: "startDate", end: "endDate" },
    orderBy: "start_date DESC NULLS LAST, created_at ASC",
  },
  {
    slug: "publications",
    table: "publications",
    responseKey: "publications",
    fields: [
      { key: "title", column: "title" },
      { key: "publicationName", column: "publication_name" },
      { key: "publicationDate", column: "publication_date", isDate: true },
      { key: "referenceUrl", column: "reference_url" },
    ],
    createSchema: publicationBase,
    updateSchema: publicationBase.partial().refine(hasAnyValue, atLeastOne),
    orderBy: "publication_date DESC NULLS LAST, created_at ASC",
  },
];

export const RECORD_SECTIONS_BY_SLUG: ReadonlyMap<string, RecordSection> =
  new Map(RECORD_SECTIONS.map((section) => [section.slug, section]));

// "" and null both mean "no value".
export function normalizeRecordValue(value: unknown): unknown {
  return value === "" ? null : value;
}

// Returns an error message when the section has a start/end pair that is out of order.
export function dateRangeProblem(
  section: RecordSection,
  values: Record<string, unknown>,
): string | null {
  if (!section.dateRange) return null;
  const start = values[section.dateRange.start];
  const end = values[section.dateRange.end];
  if (typeof start === "string" && typeof end === "string" && end < start) {
    return "The end date cannot be earlier than the start date.";
  }
  return null;
}
