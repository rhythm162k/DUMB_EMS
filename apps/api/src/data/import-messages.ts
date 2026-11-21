import { allColumns } from "./columns.js";
import { SAMPLE_ROW_ERROR } from "./sample.js";

// Security boundary: spreadsheet validation results are turned into reviewed,
// plain-language sentences. Raw validation text never reaches the browser; only
// fixed sentences and column names that exist in the template are returned.
export const INVALID_ENTRY =
  "Invalid data entry. Please check your spreadsheet and try again.";
export const INVALID_ROW =
  "Invalid data entry. Please check this row in your spreadsheet.";
export const DEPARTMENT_ID_PROBLEM =
  "Invalid data entry. The department ID must be the exact ID (UUID) of an existing department. Do not type the department name.";
const GENDER_PROBLEM =
  "Invalid data entry. Gender must be MALE, FEMALE or OTHER.";
const BLOOD_GROUP_PROBLEM =
  "Invalid data entry. Blood group must look like A+ or O-.";
const DATE_PROBLEM =
  "Invalid data entry. Dates must be written as YYYY-MM-DD, like 2026-11-17.";
const COLUMN_PROBLEM =
  "Invalid data entry. Check the values in the columns shown.";
const TYPE_PROBLEM =
  "Invalid data entry. Check rowType and action. Use the exact values from the template.";
const ID_PROBLEM =
  "Invalid data entry. The employee ID is missing or not valid.";
const HEADER_PROBLEM =
  "Invalid data entry. A column name is not recognised. Do not change the template headers.";
const REPEATED = "This row appears more than once in the file.";
const EXISTS =
  "This employee or record already exists. Use UPDATE instead of CREATE.";
const NOT_FOUND =
  "This employee was not found. Check the employee ID, or add the PROFILE row first.";
const OUT_OF_SCOPE = "This department is outside your administrator access.";
const VERSION_PROBLEM =
  "Invalid data entry. Download a fresh copy and do not change recordId or expectedUpdatedAt.";
const RECORD_ID_EMPTY =
  "Invalid data entry. Leave recordId empty for this row.";
const ROOT_PROTECTED =
  "Only the main administrator can change the main administrator's data.";
const WRONG_COLUMN =
  "Invalid data entry. A column is filled in that does not belong to this row type.";
const END_BEFORE_START = "End date cannot precede start date.";
const SAMPLE_PROBLEM =
  "This is the sample row from the template. Replace the sample employee ID with a real one, or delete the row.";

export const importRowMessages = [
  INVALID_ROW,
  DEPARTMENT_ID_PROBLEM,
  GENDER_PROBLEM,
  BLOOD_GROUP_PROBLEM,
  DATE_PROBLEM,
  COLUMN_PROBLEM,
  TYPE_PROBLEM,
  ID_PROBLEM,
  HEADER_PROBLEM,
  REPEATED,
  EXISTS,
  NOT_FOUND,
  OUT_OF_SCOPE,
  VERSION_PROBLEM,
  RECORD_ID_EMPTY,
  ROOT_PROTECTED,
  WRONG_COLUMN,
  END_BEFORE_START,
  SAMPLE_PROBLEM,
] as const;

const known = new Set<string>(allColumns);

export function friendlyRowErrors(errors: string[]): {
  errors: string[];
  columns: string[];
} {
  const messages = new Set<string>();
  const columns = new Set<string>();
  for (const error of errors) {
    if (error === SAMPLE_ROW_ERROR) messages.add(SAMPLE_PROBLEM);
    else if (
      error === "Choose a valid rowType." ||
      error.startsWith("Action must")
    )
      messages.add(TYPE_PROBLEM);
    else if (error === "Invalid official employee ID.")
      messages.add(ID_PROBLEM);
    else if (error.startsWith("Unknown column:")) messages.add(HEADER_PROBLEM);
    else if (error.startsWith("Duplicate target")) messages.add(REPEATED);
    else if (
      error.startsWith("Employee already exists") ||
      error.startsWith("Spouse record already exists")
    )
      messages.add(EXISTS);
    else if (
      error.startsWith("Employee does not exist") ||
      error === "Employee is unavailable." ||
      error === "UPDATE requires an existing employee."
    )
      messages.add(NOT_FOUND);
    else if (error.includes("outside your administrator scope"))
      messages.add(OUT_OF_SCOPE);
    else if (error === "Choose an active department ID.")
      messages.add(DEPARTMENT_ID_PROBLEM);
    else if (
      error.includes("expectedUpdatedAt") ||
      error.includes("recordId is required") ||
      error.startsWith("An existing recordId") ||
      error.startsWith("Record not found") ||
      error.startsWith("Record changed since export")
    )
      messages.add(VERSION_PROBLEM);
    else if (
      error.includes("leave recordId empty") ||
      error.includes("empty recordId")
    )
      messages.add(RECORD_ID_EMPTY);
    else if (error.startsWith("Only the root administrator"))
      messages.add(ROOT_PROTECTED);
    else if (error.startsWith("End date cannot"))
      messages.add(END_BEFORE_START);
    else if (/ does not belong to /.test(error)) messages.add(WRONG_COLUMN);
    else {
      // Schema problems look like "column: message"; only the column is kept.
      const column = /^([A-Za-z][A-Za-z0-9]*)(?:\.\S+)?: /.exec(error)?.[1];
      if (column && known.has(column)) {
        if (column === "departmentId") messages.add(DEPARTMENT_ID_PROBLEM);
        else if (column === "gender") messages.add(GENDER_PROBLEM);
        else if (column === "bloodGroup") messages.add(BLOOD_GROUP_PROBLEM);
        else if (/date/i.test(column)) {
          messages.add(DATE_PROBLEM);
          columns.add(column);
        } else {
          messages.add(COLUMN_PROBLEM);
          columns.add(column);
        }
      } else messages.add(INVALID_ROW);
    }
  }
  return { errors: [...messages], columns: [...columns] };
}
