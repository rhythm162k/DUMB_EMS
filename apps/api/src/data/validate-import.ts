import { z } from "zod";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
} from "../employees/schemas.js";
import { EMPLOYEE_UPDATE_FIELDS } from "../employees/updates.js";
import {
  RECORD_SECTIONS_BY_SLUG,
  dateRangeProblem,
} from "../records/sections.js";
import { upsertSpouseSchema } from "../spouse/schemas.js";
import { SAMPLE_ROW_ERROR, isSampleEmployeeId } from "./sample.js";
import {
  allColumns,
  controls,
  profileReadOnly,
  spouseFields,
  types,
} from "./columns.js";
import type { DataRow } from "./workbook.js";

type LookupRow = Record<string, unknown> & { id: string };
type Maybe<T> = T | Promise<T>;
export type ImportLookup = {
  employee(code: string): Maybe<LookupRow | undefined>;
  isRoot(id: string): Maybe<boolean>;
  record(
    table: string,
    employeeId: string,
    id: string,
    dateColumns: string[],
  ): Maybe<LookupRow | undefined>;
  hasSpouse(employeeId: string): Maybe<boolean>;
  activeDepartment(id: string): Maybe<boolean>;
};
const str = (v: unknown) =>
  v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
export type CheckedRow = {
  row: number;
  valid: boolean;
  errors: string[];
  data: DataRow;
  payload?: Record<string, unknown>;
};
const importCreateSchema = createEmployeeSchema.extend({
  presentAddress: z.string().max(1000).nullable().optional(),
  permanentAddress: z.string().max(1000).nullable().optional(),
});
export async function validateImportRows(
  lookup: ImportLookup,
  rows: DataRow[],
  scope: string | null = null,
  protectRoot = false,
): Promise<CheckedRow[]> {
  const seen = new Set<string>();
  const creations = new Set(
    rows
      .filter((r) => r.rowType === "PROFILE" && r.action === "CREATE")
      .map((r) => r.officialEmployeeId),
  );
  const checked: CheckedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const input = rows[i]!;
    const data = { ...input };
    const errors: string[] = [];
    const type = data.rowType;
    const action = data.action;
    // The template's example rows can never be saved, even if the file is uploaded unchanged.
    if (isSampleEmployeeId(data.officialEmployeeId)) {
      checked.push({
        row: i + 2,
        valid: false,
        errors: [SAMPLE_ROW_ERROR],
        data,
      });
      continue;
    }
    if (!types.includes(type ?? "")) errors.push("Choose a valid rowType.");
    if (!["CREATE", "UPDATE"].includes(action ?? ""))
      errors.push("Action must be CREATE or UPDATE.");
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(data.officialEmployeeId ?? ""))
      errors.push("Invalid official employee ID.");
    for (const [key, value] of Object.entries(data))
      if (!allColumns.includes(key)) errors.push(`Unknown column: ${key}`);
      else if (value.length > 10000) errors.push(`Value too long: ${key}`);
    const identity = `${data.officialEmployeeId}:${type}:${data.recordId || (type === "PROFILE" || type === "SPOUSE" ? "single" : i)}`;
    if (seen.has(identity)) errors.push("Duplicate target within the file.");
    seen.add(identity);
    const employee = await lookup.employee(data.officialEmployeeId ?? "");
    if (employee && protectRoot) {
      if (await lookup.isRoot(employee.id))
        errors.push(
          "Only the root administrator can change the root administrator's data.",
        );
    }
    if (type === "PROFILE" && action === "CREATE" && employee)
      errors.push(
        "Employee already exists. Choose UPDATE; no overwrite is automatic.",
      );
    if (
      !employee &&
      !(type === "PROFILE" && action === "CREATE") &&
      !creations.has(data.officialEmployeeId)
    )
      errors.push("Employee does not exist or is not selected for creation.");
    if (
      scope &&
      type === "PROFILE" &&
      ((action === "CREATE" && data.departmentId !== scope) ||
        (action === "UPDATE" &&
          data.departmentId &&
          data.departmentId !== "[MASKED]" &&
          data.departmentId !== scope))
    )
      errors.push("Employee department is outside your administrator scope.");
    // Do not inspect related records or expose their versions for inaccessible employees.
    if (
      scope &&
      !employee &&
      !(type === "PROFILE" && action === "CREATE") &&
      !creations.has(data.officialEmployeeId)
    ) {
      checked.push({
        row: i + 2,
        valid: false,
        errors: ["Employee is unavailable."],
        data,
      });
      continue;
    }
    let version: unknown = employee?.updated_at;
    const section = RECORD_SECTIONS_BY_SLUG.get(type ?? "");
    const fields =
      type === "PROFILE"
        ? EMPLOYEE_UPDATE_FIELDS
        : type === "SPOUSE"
          ? spouseFields.map(([key, column]) => ({ key, column }))
          : (section?.fields ?? []);
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = data[f.key];
      const value =
        raw?.startsWith("'") && /^[\s]*[=+@\-\t\r]/.test(raw.slice(1))
          ? raw.slice(1)
          : raw;
      // Blank UPDATE cells mean unchanged; explicit [CLEAR] clears an optional field.
      if (value === undefined || value === "" || value === "[MASKED]") continue;
      payload[f.key] =
        value === "[CLEAR]"
          ? null
          : f.key === "passingYear"
            ? Number(value)
            : value;
    }
    if (
      scope &&
      Object.hasOwn(payload, "departmentId") &&
      payload.departmentId !== scope
    )
      errors.push("Department is outside your administrator scope.");
    const allowed = new Set([
      ...controls,
      ...(type === "PROFILE" ? profileReadOnly : []),
      ...fields.map((f) => f.key),
    ]);
    for (const [key, value] of Object.entries(data))
      if (value && !allowed.has(key))
        errors.push(`${key} does not belong to ${type}.`);
    if (type === "PROFILE" && action === "CREATE")
      payload.officialEmployeeId = data.officialEmployeeId;
    if (type === "PROFILE" && data.recordId)
      errors.push("PROFILE uses officialEmployeeId; leave recordId empty.");
    if (type !== "PROFILE" && employee) {
      if (action === "UPDATE") {
        if (!z.string().uuid().safeParse(data.recordId).success)
          errors.push("An existing recordId is required for UPDATE.");
        else if (type === "SPOUSE" || section) {
          const table = type === "SPOUSE" ? "employee_spouse" : section!.table;
          const dateColumns =
            type === "SPOUSE"
              ? ["spouse_date_of_birth"]
              : section!.fields.filter((f) => f.isDate).map((f) => f.column);
          const record = await lookup.record(
            table,
            employee.id,
            data.recordId!,
            dateColumns,
          );
          if (!record) errors.push("Record not found for this employee.");
          else {
            version = record.updated_at;
            for (const f of fields)
              if (!(f.key in payload))
                payload[f.key] =
                  record[f.column] instanceof Date
                    ? (record[f.column] as Date).toISOString().slice(0, 10)
                    : record[f.column];
          }
        }
      } else if (type === "SPOUSE" && (await lookup.hasSpouse(employee.id)))
        errors.push("Spouse record already exists. Use UPDATE.");
    }
    if (action === "CREATE" && data.recordId)
      errors.push("CREATE must have an empty recordId.");
    if (action === "UPDATE") {
      if (!employee) errors.push("UPDATE requires an existing employee.");
      if (!data.expectedUpdatedAt)
        errors.push("UPDATE requires expectedUpdatedAt from a recent export.");
      else if (str(version) !== data.expectedUpdatedAt)
        errors.push(
          "Record changed since export. Export it again before updating.",
        );
    }
    const schema =
      type === "PROFILE"
        ? action === "CREATE"
          ? importCreateSchema
          : updateEmployeeSchema
        : type === "SPOUSE"
          ? upsertSpouseSchema
          : section?.createSchema;
    const parsed = schema?.safeParse(payload);
    if (!parsed?.success)
      errors.push(
        ...(parsed?.error.issues.map(
          (e) => `${e.path.join(".")}: ${e.message}`,
        ) ?? ["Unknown row type."]),
      );
    if (section && dateRangeProblem(section, payload))
      errors.push("End date cannot precede start date.");
    if (
      payload.departmentId &&
      (!z.string().uuid().safeParse(payload.departmentId).success ||
        !(await lookup.activeDepartment(String(payload.departmentId))))
    )
      errors.push("Choose an active department ID.");
    checked.push({
      row: i + 2,
      valid: errors.length === 0,
      errors,
      data,
      ...(parsed?.success
        ? { payload: parsed.data as Record<string, unknown> }
        : {}),
    });
  }
  return checked;
}
