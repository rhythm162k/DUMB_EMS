import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import type { Request } from "express";
import { z } from "zod";
import { DemoHttpError, type DemoSession } from "./session.js";

export const uuid = z.string().uuid();
export const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const statement = (
  sql: string,
  ...args: (string | number | null | ArrayBuffer)[]
) => env.DB.prepare(sql).bind(...args);

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DemoHttpError(400, "VALIDATION_ERROR");
  return result.data;
}

export function expectedVersion(req: Request, actual: number) {
  const header = req.get("If-Match");
  if (
    header !== undefined &&
    header !== String(actual) &&
    header !== '"' + actual + '"'
  )
    throw new DemoHttpError(409, "CHANGE_CONFLICT");
  return actual;
}

export const assertion = (
  expression: string,
  ...args: (string | number | null)[]
) =>
  statement(
    "INSERT INTO write_assertion (ok) VALUES (" +
      expression +
      ") ON CONFLICT(ok) DO NOTHING",
    ...args,
  );
export const changedOne = () => assertion("changes()=1");

export async function write(
  session: DemoSession,
  statements: D1PreparedStatement[],
) {
  await env.DB.batch([
    assertion(
      `EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
      JOIN users u ON u.workspace_id=s.workspace_id AND u.id=s.user_id
      JOIN employees e ON e.workspace_id=u.workspace_id AND e.id=u.employee_id
      WHERE s.workspace_id=? AND s.token_hash=? AND s.user_id=? AND w.expires_at>unixepoch()
        AND u.account_status='ACTIVE' AND e.employment_status='ACTIVE')`,
      session.workspaceId,
      session.tokenHash,
      session.id,
    ),
    ...statements,
  ]);
}

export function audit(
  session: DemoSession,
  action: string,
  entity: string,
  id: string,
  reason?: string,
  metadata: object = {},
) {
  return statement(
    `INSERT INTO audit_logs (workspace_id,id,actor_user_id,actor_role,action,entity_type,entity_id,reason,metadata)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    session.workspaceId,
    randomUUID(),
    session.id,
    session.role,
    action,
    entity,
    id,
    reason ?? null,
    JSON.stringify(metadata),
  );
}

// Data is always selected from the current workspace, including the target account.
export function employee(session: DemoSession, id: string) {
  return statement(
    `SELECT e.*, u.id AS user_id, u.role AS account_role,u.entry_persona,
    u.is_root,u.account_status,u.version AS account_version FROM employees e
    LEFT JOIN users u ON u.workspace_id=e.workspace_id AND u.employee_id=e.id
    WHERE e.workspace_id=? AND e.id=?`,
    session.workspaceId,
    id,
  ).first<
    Record<string, unknown> & {
      version: number;
      account_version: number | null;
      department_id: string;
      account_role: string | null;
      is_root: number | null;
    }
  >();
}

export async function adminTarget(session: DemoSession, id: string) {
  const row = await employee(session, id);
  if (!row) throw new DemoHttpError(404, "EMPLOYEE_NOT_FOUND");
  checkAdminTarget(session, row);
  return row;
}

export function checkAdminTarget(
  session: DemoSession,
  row: { department_id?: unknown; account_role?: unknown; is_root?: unknown },
) {
  if (
    session.administeredDepartmentId &&
    (row.department_id !== session.administeredDepartmentId ||
      row.account_role === "ADMIN")
  )
    throw new DemoHttpError(403, "FORBIDDEN");
  if (row.is_root && !session.isRoot)
    throw new DemoHttpError(409, "ROOT_ADMIN_PROTECTED");
}

export function guardTarget(session: DemoSession, id: string) {
  return assertion(
    `EXISTS (SELECT 1 FROM employees e LEFT JOIN users u
    ON u.workspace_id=e.workspace_id AND u.employee_id=e.id
    WHERE e.workspace_id=?1 AND e.id=?2 AND (?3 IS NULL OR
      (e.department_id=?3 AND u.role IS NOT 'ADMIN')) AND (coalesce(u.is_root,0)=0 OR ?4=1))`,
    session.workspaceId,
    id,
    session.administeredDepartmentId,
    session.isRoot,
  );
}

export async function activeDepartment(session: DemoSession, id: string) {
  if (
    session.administeredDepartmentId &&
    session.administeredDepartmentId !== id
  )
    throw new DemoHttpError(403, "FORBIDDEN");
  if (
    !(await statement(
      "SELECT 1 FROM departments WHERE workspace_id=? AND id=? AND is_active=1",
      session.workspaceId,
      id,
    ).first())
  )
    throw new DemoHttpError(400, "DEPARTMENT_INVALID");
}

export const guardDepartment = (session: DemoSession, id: string) =>
  assertion(
    "EXISTS (SELECT 1 FROM departments WHERE workspace_id=? AND id=? AND is_active=1)",
    session.workspaceId,
    id,
  );

export function fields(
  values: object,
  mapping: readonly { key: string; column: string }[],
) {
  const input = values as Record<string, string | number | null | undefined>;
  return mapping.flatMap(({ key, column }) =>
    input[key] === undefined
      ? []
      : [{ key, column, value: input[key] === "" ? null : input[key] }],
  );
}

export function patch(
  table: string,
  data: { column: string; value: string | number | null }[],
  where: string,
  ...args: (string | number | null)[]
) {
  return statement(
    `UPDATE ${table} SET ${data.map(({ column }) => column + "=?").join(",")},
    version=version+1,updated_at=${stamp} WHERE ${where}`,
    ...data.map(({ value }) => value),
    ...args,
  );
}
