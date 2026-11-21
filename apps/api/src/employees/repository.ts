import { employeeScopeSql } from "../auth/scope.js";
import { pool } from "../config/database.js";

import type { EmployeeDetailRow, EmployeeListRow } from "./types.js";

export type { EmployeeDetailRow, EmployeeListRow } from "./types.js";

// DATE columns are formatted in SQL so the pg driver cannot shift them by the
// server timezone when converting to JavaScript Date objects.
const DETAIL_SELECT = `
  e.id,
  e.official_employee_id,
  e.employment_status,
  e.first_name_en,
  e.last_name_en,
  e.full_name_bn,
  to_char(e.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
  e.gender,
  e.blood_group,
  e.national_id,
  e.phone,
  e.email,
  e.present_address,
  e.permanent_address,
  e.designation,
  to_char(e.joining_date, 'YYYY-MM-DD') AS joining_date,
  e.father_name,
  e.mother_name,
  e.religion,
  e.marital_status,
  e.profile_image_key,
  e.created_at,
  e.updated_at,
  d.id AS department_id,
  d.name_en AS department_name_en,
  d.name_bn AS department_name_bn,
  u.role AS account_role, u.admin_scope, u.is_root AS account_is_root, u.administered_department_id,
  u.account_status,
  u.must_change_password,
  u.last_login_at`;

const DETAIL_FROM = `
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN users u ON u.employee_id = e.id`;

export async function getEmployeeDetail(
  employeeId: string,
): Promise<EmployeeDetailRow | undefined> {
  const result = await pool.query<EmployeeDetailRow>(
    `SELECT ${DETAIL_SELECT} ${DETAIL_FROM} WHERE e.id = $1 LIMIT 1`,
    [employeeId],
  );
  return result.rows[0];
}

export type EmployeeListFilters = {
  q?: string;
  departmentId?: string;
  employmentStatus?: string;
  page: number;
  pageSize: number;
};

// Escape LIKE wildcards so a search for "%" or "_" matches the literal character.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listEmployees(
  filters: EmployeeListFilters,
  scope: string | null = null,
) {
  // Only fixed SQL fragments are concatenated; every user-supplied value is a bound parameter.
  const conditions: string[] = [employeeScopeSql("e", "$1")];
  const params: unknown[] = [scope];

  if (filters.q) {
    params.push(`%${escapeLike(filters.q)}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(e.official_employee_id ILIKE ${p}
        OR e.first_name_en ILIKE ${p}
        OR COALESCE(e.last_name_en, '') ILIKE ${p}
        OR (e.first_name_en || ' ' || COALESCE(e.last_name_en, '')) ILIKE ${p}
        OR COALESCE(e.full_name_bn, '') ILIKE ${p})`,
    );
  }
  if (filters.departmentId) {
    params.push(filters.departmentId);
    conditions.push(`e.department_id = $${params.length}`);
  }
  if (filters.employmentStatus) {
    params.push(filters.employmentStatus);
    conditions.push(`e.employment_status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const offset = (filters.page - 1) * filters.pageSize;
  const pageParams = [...params, filters.pageSize, offset];

  const [countResult, rowsResult] = await Promise.all([
    pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total ${DETAIL_FROM} ${where}`,
      params,
    ),
    pool.query<EmployeeListRow>(
      `SELECT
         e.id, e.official_employee_id, e.first_name_en, e.last_name_en, e.full_name_bn,
         e.designation, e.employment_status,
         d.id AS department_id, d.name_en AS department_name_en, d.name_bn AS department_name_bn,
         u.role AS account_role, u.admin_scope, u.administered_department_id, u.account_status
       ${DETAIL_FROM}
       ${where}
       ORDER BY e.first_name_en ASC, e.last_name_en ASC NULLS LAST, e.official_employee_id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    ),
  ]);

  const total = Number(countResult.rows[0]?.total ?? 0);
  return { rows: rowsResult.rows, total };
}
