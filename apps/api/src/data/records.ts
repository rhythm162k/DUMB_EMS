import { employeeScopeSql } from "../auth/scope.js";
import type { PoolClient } from "pg";
import {
  EMPLOYEE_UPDATE_FIELDS,
  EMPLOYEE_UPDATE_SELECT,
} from "../employees/updates.js";
import { RECORD_SECTIONS } from "../records/sections.js";
import type { DataRow } from "./workbook.js";
import { spouseFields } from "./columns.js";
import { validateImportRows } from "./validate-import.js";
export * from "./columns.js";
export type { CheckedRow } from "./validate-import.js";
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

export async function validateImport(
  client: PoolClient,
  rows: DataRow[],
  lock = false,
  scope: string | null = null,
  protectRoot = false,
) {
  if (lock) await client.query("SELECT pg_advisory_xact_lock(734612)");
  return validateImportRows(
    {
      employee: async (code) =>
        (
          await client.query(
            `SELECT id,updated_at,department_id FROM employees e WHERE official_employee_id=$1 AND ${employeeScopeSql("e", "$2")} ${lock ? "FOR UPDATE" : ""}`,
            [code, scope],
          )
        ).rows[0],
      isRoot: async (id) =>
        Boolean(
          (
            await client.query(
              "SELECT 1 FROM users WHERE employee_id=$1 AND is_root",
              [id],
            )
          ).rowCount,
        ),
      record: async (table, employeeId, id, dateColumns) => {
        const dates = dateColumns.map(
          (column) => `to_char(${column}, 'YYYY-MM-DD') AS ${column}`,
        );
        return (
          await client.query(
            `SELECT *${dates.length ? "," + dates.join(",") : ""} FROM ${table} WHERE employee_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
            [employeeId, id],
          )
        ).rows[0];
      },
      hasSpouse: async (employeeId) =>
        Boolean(
          (
            await client.query(
              "SELECT id FROM employee_spouse WHERE employee_id=$1",
              [employeeId],
            )
          ).rowCount,
        ),
      activeDepartment: async (id) =>
        Boolean(
          (
            await client.query(
              "SELECT id FROM departments WHERE id=$1 AND is_active=TRUE",
              [id],
            )
          ).rowCount,
        ),
    },
    rows,
    scope,
    protectRoot,
  );
}
