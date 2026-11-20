// Static allowlist for the Admin direct-edit endpoint. Only these keys can ever reach SQL,
// and only through this mapping; client-supplied names are never used as column names.
export type UpdatableField = { key: string; column: string; isDate?: boolean };

export const EMPLOYEE_UPDATE_FIELDS: readonly UpdatableField[] = [
  { key: "firstNameEn", column: "first_name_en" },
  { key: "lastNameEn", column: "last_name_en" },
  { key: "fullNameBn", column: "full_name_bn" },
  { key: "departmentId", column: "department_id" },
  { key: "gender", column: "gender" },
  { key: "bloodGroup", column: "blood_group" },
  { key: "dateOfBirth", column: "date_of_birth", isDate: true },
  { key: "joiningDate", column: "joining_date", isDate: true },
  { key: "nationalId", column: "national_id" },
  { key: "phone", column: "phone" },
  { key: "email", column: "email" },
  { key: "presentAddress", column: "present_address" },
  { key: "permanentAddress", column: "permanent_address" },
  { key: "designation", column: "designation" },
  { key: "fatherName", column: "father_name" },
  { key: "motherName", column: "mother_name" },
  { key: "religion", column: "religion" },
  { key: "maritalStatus", column: "marital_status" },
];

// "" and null both mean "clear this optional value".
export function normalizeUpdateValue(value: unknown): unknown {
  return value === "" ? null : value;
}

// DATE columns are formatted in SQL so the pg driver cannot shift them by the server timezone.
export const EMPLOYEE_UPDATE_SELECT = EMPLOYEE_UPDATE_FIELDS.map((field) =>
  field.isDate
    ? `to_char(${field.column}, 'YYYY-MM-DD') AS ${field.column}`
    : field.column,
).join(", ");
