import type { Request } from "express";
import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import type { AuthenticatedUser } from "./types.js";

export class ScopeError extends Error {
  readonly status = 403;
  constructor() {
    super("You do not have permission to access this resource.");
  }
}
export class RootProtectedError extends Error {
  readonly status = 409;
  constructor() {
    super(
      "Only the root administrator can change the root administrator's data.",
    );
  }
}
export const isFullAdmin = (user: AuthenticatedUser) =>
  user.role === "ADMIN" && user.adminScope === "FULL";
export const isRootAdmin = (user: AuthenticatedUser) =>
  isFullAdmin(user) && user.isRoot;

// Fixed identifiers supplied by application code only. Values are always bound.
// Exclude administrator accounts from department administration, including self.
export function employeeScopeSql(alias: string, parameter: string): string {
  return `(${parameter}::uuid IS NULL OR (${alias}.department_id = ${parameter}::uuid AND NOT EXISTS (SELECT 1 FROM users scope_user WHERE scope_user.employee_id = ${alias}.id AND scope_user.role = 'ADMIN')))`;
}
export function departmentScope(user: AuthenticatedUser): string | null {
  if (isFullAdmin(user)) return null;
  if (
    user.role === "ADMIN" &&
    user.adminScope === "DEPARTMENT" &&
    user.administeredDepartmentId
  )
    return user.administeredDepartmentId;
  throw new ScopeError();
}
export async function canAccessEmployee(
  user: AuthenticatedUser,
  employeeId: string,
  client: Pick<PoolClient, "query"> = pool,
): Promise<boolean> {
  if (user.role !== "ADMIN") return false;
  const department = departmentScope(user);
  if (!department) return true;
  const result = await client.query(
    `SELECT e.id FROM employees e WHERE e.id = $1 AND ${employeeScopeSql("e", "$2")}`,
    [employeeId, department],
  );
  return Boolean(result.rowCount);
}
export async function assertEmployeeAccess(
  user: AuthenticatedUser,
  employeeId: string,
  client: Pick<PoolClient, "query"> = pool,
): Promise<void> {
  if (!(await canAccessEmployee(user, employeeId, client)))
    throw new ScopeError();
  // Every caller is a write. The root account is untouchable by anyone else,
  // including other full-access administrators.
  if (!isRootAdmin(user)) {
    const root = await client.query(
      "SELECT 1 FROM users WHERE employee_id = $1 AND is_root",
      [employeeId],
    );
    if (root.rowCount) throw new RootProtectedError();
  }
}
export function assertDepartmentAccess(
  user: AuthenticatedUser,
  departmentId: unknown,
): void {
  const scope = departmentScope(user);
  if (scope && departmentId !== scope) throw new ScopeError();
}

// Applied by every ADMIN gate, including nested PDS records and image writes.
// Lists still need SQL predicates BEFORE their limit/count/aggregation.
export async function authorizeAdminRequest(req: Request): Promise<void> {
  const user = req.authUser!;
  if (!departmentScope(user)) return;
  const path = req.originalUrl.split("?")[0]!;
  if (
    /\/admin\/(departments|leave-types|holidays)(\/|$)/.test(path) ||
    path.endsWith("/data/audit")
  )
    throw new ScopeError();
  const employeeId = req.params.employeeId;
  if (typeof employeeId === "string" && /^[0-9a-f-]{36}$/i.test(employeeId))
    await assertEmployeeAccess(user, employeeId);
  if (req.body?.employeeId && /^[0-9a-f-]{36}$/i.test(req.body.employeeId))
    await assertEmployeeAccess(user, req.body.employeeId);
  if (req.body?.departmentId !== undefined)
    assertDepartmentAccess(user, req.body.departmentId);
  if (req.query.departmentId !== undefined)
    assertDepartmentAccess(user, req.query.departmentId);
  if (req.params.requestId && path.includes("/change-requests/")) {
    const result = await pool.query(
      "SELECT employee_id FROM change_requests WHERE id::text=$1",
      [req.params.requestId],
    );
    if (result.rows[0])
      await assertEmployeeAccess(user, result.rows[0].employee_id);
  }
  if (req.params.id && path.includes("/admin/leaves/")) {
    const result = await pool.query(
      "SELECT employee_id FROM leave_records WHERE id::text=$1",
      [req.params.id],
    );
    if (result.rows[0])
      await assertEmployeeAccess(user, result.rows[0].employee_id);
  }
}
