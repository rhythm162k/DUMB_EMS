// The template's example rows use this employee ID. Rows that carry it are never
// imported, so an admin who uploads the template unchanged cannot create sample data.
export const SAMPLE_EMPLOYEE_ID = "SAMPLE-000001";
export const SAMPLE_ROW_ERROR = "Sample row from the template.";
export const isSampleEmployeeId = (value: string | undefined): boolean =>
  /^SAMPLE-/i.test((value ?? "").trim());
