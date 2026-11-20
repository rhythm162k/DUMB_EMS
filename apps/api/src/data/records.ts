import { employeeScopeSql } from "../auth/scope.js";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
} from "../employees/schemas.js";
import {
  EMPLOYEE_UPDATE_FIELDS,
  EMPLOYEE_UPDATE_SELECT,
} from "../employees/updates.js";
import {
  RECORD_SECTIONS,
  RECORD_SECTIONS_BY_SLUG,
  dateRangeProblem,
} from "../records/sections.js";
import { upsertSpouseSchema } from "../spouse/schemas.js";
import { SAMPLE_ROW_ERROR, isSampleEmployeeId } from "./sample.js";
import type { DataRow, Sheet } from "./spreadsheets.js";

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
const str = (v: unknown) =>
  v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
const masked = (v: string) => (v ? "[MASKED]" : "");
export async function exportRecords(
  client: PoolClient,
  ids: string[],
  sensitive: boolean,
): Promise<DataRow[]> {
  const result: DataRow[] = [];
  for (const id of ids) {
    const e = (
      await client.query(
        `SELECT id, official_employee_id, employment_status, updated_at, ${EMPLOYEE_UPDATE_SELECT} FROM employees WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!e) continue;
    const common = {
      officialEmployeeId: e.official_employee_id as string,
      action: "UPDATE",
    };
    const profile: DataRow = {
      ...common,
      rowType: "PROFILE",
      recordId: "",
      expectedUpdatedAt: str(e.updated_at),
    };
    for (const f of EMPLOYEE_UPDATE_FIELDS) profile[f.key] = str(e[f.column]);
    profile.employmentStatus = str(e.employment_status);
    const department = e.department_id
      ? (
          await client.query(
            "SELECT name_en,name_bn FROM departments WHERE id=$1",
            [e.department_id],
          )
        ).rows[0]
      : null;
    profile.departmentNameEn = str(department?.name_en);
    profile.departmentNameBn = str(department?.name_bn);
    if (!sensitive)
      for (const key of [
        "nationalId",
        "dateOfBirth",
        "phone",
        "email",
        "presentAddress",
        "permanentAddress",
        "fatherName",
        "motherName",
      ])
        profile[key] = masked(profile[key] ?? "");
    result.push(profile);
    const spouse = (
      await client.query(
        "SELECT *,to_char(spouse_date_of_birth,'YYYY-MM-DD') AS spouse_date_of_birth FROM employee_spouse WHERE employee_id=$1",
        [id],
      )
    ).rows[0];
    if (spouse) {
      const r: DataRow = {
        ...common,
        rowType: "SPOUSE",
        recordId: spouse.id,
        expectedUpdatedAt: str(spouse.updated_at),
      };
      for (const [key, column] of spouseFields) r[key] = str(spouse[column]);
      if (!sensitive) {
        r.spouseNationalId = masked(r.spouseNationalId!);
        r.spouseDateOfBirth = masked(r.spouseDateOfBirth!);
      }
      result.push(r);
    }
    for (const s of RECORD_SECTIONS) {
      const rows = await client.query(
        `SELECT id,updated_at,${s.fields.map((f) => (f.isDate ? `to_char(${f.column},'YYYY-MM-DD') AS ${f.column}` : f.column)).join(",")} FROM ${s.table} WHERE employee_id=$1 ORDER BY ${s.orderBy}`,
        [id],
      );
      for (const row of rows.rows) {
        const r: DataRow = {
          ...common,
          rowType: s.slug,
          recordId: row.id,
          expectedUpdatedAt: str(row.updated_at),
        };
        for (const f of s.fields) r[f.key] = str(row[f.column]);
        result.push(r);
      }
    }
  }
  return result;
}
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
export async function validateImport(
  client: PoolClient,
  rows: DataRow[],
  lock = false,
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
  // All import writers serialize here, including overlapping selected batches.
  if (lock) await client.query("SELECT pg_advisory_xact_lock(734612)");
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
    const employee = (
      await client.query(
        `SELECT id,updated_at,department_id FROM employees e WHERE official_employee_id=$1 AND ${employeeScopeSql("e", "$2")} ${lock ? "FOR UPDATE" : ""}`,
        [data.officialEmployeeId ?? "", scope],
      )
    ).rows[0];
    if (employee && protectRoot) {
      const root = await client.query(
        "SELECT 1 FROM users WHERE employee_id=$1 AND is_root",
        [employee.id],
      );
      if (root.rowCount)
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
          const dateSelect = dateColumns.map(
            (column) => `to_char(${column}, 'YYYY-MM-DD') AS ${column}`,
          );
          const record = (
            await client.query(
              `SELECT *${dateSelect.length ? "," + dateSelect.join(",") : ""} FROM ${table} WHERE employee_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
              [employee.id, data.recordId],
            )
          ).rows[0];
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
      } else if (
        type === "SPOUSE" &&
        (
          await client.query(
            "SELECT id FROM employee_spouse WHERE employee_id=$1",
            [employee.id],
          )
        ).rowCount
      )
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
        !(
          await client.query(
            "SELECT id FROM departments WHERE id=$1 AND is_active=TRUE",
            [payload.departmentId],
          )
        ).rowCount)
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
