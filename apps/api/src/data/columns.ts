import { EMPLOYEE_UPDATE_FIELDS } from "../employees/updates.js";
import {
  RECORD_SECTIONS,
  RECORD_SECTIONS_BY_SLUG,
} from "../records/sections.js";
import type { DataRow, Sheet } from "./workbook.js";
export const controls = [
  "rowType",
  "action",
  "officialEmployeeId",
  "recordId",
  "expectedUpdatedAt",
];
export const profileReadOnly = [
  "employmentStatus",
  "departmentNameEn",
  "departmentNameBn",
];
export const profileFields = EMPLOYEE_UPDATE_FIELDS.map((f) => f.key);
export const spouseFields = [
  ["spouseName", "spouse_name"],
  ["spouseOccupation", "spouse_occupation"],
  ["spouseDateOfBirth", "spouse_date_of_birth"],
  ["spouseNationalId", "spouse_national_id"],
] as const;
export const allColumns = [
  ...new Set([
    ...controls,
    ...profileReadOnly,
    ...profileFields,
    ...spouseFields.map((f) => f[0]),
    ...RECORD_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)),
  ]),
];
export const types = [
  "PROFILE",
  "SPOUSE",
  ...RECORD_SECTIONS.map((s) => s.slug),
];
export function sheetsFor(rows: DataRow[]): Sheet[] {
  return types.map((type) => ({
    name: type,
    columns: [
      ...controls,
      ...(type === "PROFILE"
        ? [...profileReadOnly, ...profileFields]
        : type === "SPOUSE"
          ? spouseFields.map((f) => f[0])
          : RECORD_SECTIONS_BY_SLUG.get(type)!.fields.map((f) => f.key)),
    ],
    rows: rows.filter((r) => r.rowType === type),
  }));
}
