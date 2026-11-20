import {
  departmentScope,
  employeeScopeSql,
  assertDepartmentAccess,
} from "../auth/scope.js";
import type { AuthenticatedUser } from "../auth/types.js";
import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import {
  requireActiveEmployee,
  requireAuth,
  requireRole,
  requireFullAdmin,
} from "../auth/middleware.js";
import { createEmployeeSchema } from "../employees/schemas.js";
import { generateTemporaryPassword } from "../auth/security.js";
import { recordAudit } from "../audit/audit.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const columns = [
  "officialEmployeeId",
  "firstNameEn",
  "lastNameEn",
  "departmentId",
  "gender",
  "bloodGroup",
  "designation",
  "joiningDate",
  "email",
  "phone",
] as const;
const csvCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  // Guard against spreadsheet formula injection when exporting personal data.
  const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
const csv = (rows: Record<string, unknown>[]) =>
  [
    columns.join(","),
    ...rows.map((row) => columns.map((k) => csvCell(row[k])).join(",")),
  ].join("\r\n") + "\r\n";
const bad = (message: string) => ({
  error: { code: "VALIDATION_ERROR", message },
});

router.get(
  "/admin/data/template.csv",
  requireAuth,
  requireRole("ADMIN"),
  (_req, res) => {
    res
      .type("text/csv; charset=utf-8")
      .attachment("ems-import-template.csv")
      .send(columns.join(",") + "\r\n");
  },
);
router.get(
  "/admin/data/employees.csv",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT official_employee_id AS "officialEmployeeId", first_name_en AS "firstNameEn", last_name_en AS "lastNameEn", department_id AS "departmentId", gender, blood_group AS "bloodGroup", designation, to_char(joining_date, 'YYYY-MM-DD') AS "joiningDate", CASE WHEN email IS NULL THEN NULL ELSE '[MASKED]' END AS email, CASE WHEN phone IS NULL THEN NULL ELSE '[MASKED]' END AS phone FROM employees e WHERE ${employeeScopeSql("e", "$1")} ORDER BY official_employee_id LIMIT 20000`,
        [departmentScope(req.authUser!)],
      );
      await auditExport(req.authUser!, null, result.rows.length);
      res
        .type("text/csv; charset=utf-8")
        .attachment("ems-employees.csv")
        .send(csv(result.rows));
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/me/data/profile.csv",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    try {
      const id = req.authUser?.employeeRecordId;
      if (!id) {
        res.status(403).json(bad("Employee profile unavailable."));
        return;
      }
      const result = await pool.query(
        `SELECT official_employee_id AS "officialEmployeeId", first_name_en AS "firstNameEn", last_name_en AS "lastNameEn", department_id AS "departmentId", gender, blood_group AS "bloodGroup", designation, to_char(joining_date, 'YYYY-MM-DD') AS "joiningDate", CASE WHEN email IS NULL THEN NULL ELSE '[MASKED]' END AS email, CASE WHEN phone IS NULL THEN NULL ELSE '[MASKED]' END AS phone FROM employees WHERE id=$1`,
        [id],
      );
      if (!result.rowCount) {
        res.status(404).json({
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "Employee profile unavailable.",
          },
        });
        return;
      }
      await auditExport(req.authUser!, id, result.rows.length);
      res
        .type("text/csv; charset=utf-8")
        .attachment("my-ems-profile.csv")
        .send(csv(result.rows));
    } catch (error) {
      next(error);
    }
  },
);
// Record the export before releasing personal data. No CSV values enter the audit log.
async function auditExport(
  actor: { userId: string; role: string },
  employeeId: string | null,
  rowCount: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recordAudit(client, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: employeeId ? "EMPLOYEE_SELF_EXPORTED" : "EMPLOYEES_EXPORTED",
      entityType: "employee",
      entityId: employeeId,
      metadata: {
        format: "csv",
        scope: employeeId ? "self" : "admin-list",
        rowCount,
      },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
const batchSchema = z.strictObject({
  rows: z.array(z.unknown()).min(1).max(100),
});
async function validateRows(rows: unknown[], user: AuthenticatedUser) {
  const results = rows.map((row, index) => {
    const parsed = createEmployeeSchema.safeParse(row);
    return {
      row: index + 2,
      valid: parsed.success,
      errors: parsed.success
        ? []
        : ["Please check this row in your spreadsheet and try again."],
      data: parsed.success ? parsed.data : null,
    };
  });
  for (const result of results) {
    if (result.data) assertDepartmentAccess(user, result.data.departmentId);
  }
  const valid = results.filter((r) => r.data !== null);
  const ids = valid.map((r) => r.data!.officialEmployeeId);
  const duplicates = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  const departments = [...new Set(valid.map((r) => r.data!.departmentId))];
  const active = departments.length
    ? await pool.query<{ id: string }>(
        "SELECT id FROM departments WHERE id = ANY($1::uuid[]) AND is_active=TRUE",
        [departments],
      )
    : { rows: [] };
  const activeIds = new Set(active.rows.map((r) => r.id));
  const existing = ids.length
    ? await pool.query<{ official_employee_id: string }>(
        `SELECT official_employee_id FROM employees e WHERE official_employee_id = ANY($1::text[]) AND ${employeeScopeSql("e", "$2")}`,
        [ids, departmentScope(user)],
      )
    : { rows: [] };
  const existingIds = new Set(existing.rows.map((r) => r.official_employee_id));
  return results.map((result) => {
    const errors = [...result.errors];
    if (result.data) {
      if (duplicates.has(result.data.officialEmployeeId))
        errors.push("Duplicate employee ID within import.");
      if (existingIds.has(result.data.officialEmployeeId))
        errors.push("Employee ID already exists.");
      if (!activeIds.has(result.data.departmentId))
        errors.push("Department must exist and be active.");
    }
    return { row: result.row, valid: errors.length === 0, errors };
  });
}
router.post(
  "/admin/data/import/preview",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Supply 1–100 employee records."));
      return;
    }
    try {
      res.json({
        results: await validateRows(parsed.data.rows, req.authUser!),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/admin/data/import/commit",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Supply 1–100 employee records."));
      return;
    }
    try {
      const results = await validateRows(parsed.data.rows, req.authUser!);
      if (results.some((r) => !r.valid)) {
        res.status(422).json({
          error: {
            code: "IMPORT_INVALID",
            message: "Correct preview errors before importing.",
          },
          results,
        });
        return;
      }
      const data = parsed.data.rows.map((row) =>
        createEmployeeSchema.parse(row),
      );
      // Hash outside the transaction to avoid holding a DB connection during bcrypt work.
      const credentials = await Promise.all(
        data.map(async () => {
          const password = generateTemporaryPassword();
          return {
            password,
            hash: await bcrypt.hash(password, env.BCRYPT_COST),
          };
        }),
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const created: { employeeId: string; temporaryPassword: string }[] = [];
        for (let i = 0; i < data.length; i++) {
          const d = data[i]!;
          const employee = await client.query<{ id: string }>(
            `INSERT INTO employees (official_employee_id, department_id, employment_status, first_name_en, last_name_en, full_name_bn, date_of_birth, gender, blood_group, national_id, phone, email, designation, joining_date, father_name, mother_name, religion, marital_status, created_by, updated_by) VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING id`,
            [
              d.officialEmployeeId,
              d.departmentId,
              d.firstNameEn,
              d.lastNameEn,
              d.fullNameBn,
              d.dateOfBirth,
              d.gender,
              d.bloodGroup,
              d.nationalId,
              d.phone,
              d.email,
              d.designation,
              d.joiningDate,
              d.fatherName,
              d.motherName,
              d.religion,
              d.maritalStatus,
              req.authUser!.userId,
            ],
          );
          await client.query(
            "INSERT INTO users (employee_id,password_hash,role,account_status,must_change_password) VALUES ($1,$2,'EMPLOYEE','ACTIVE',TRUE)",
            [employee.rows[0]!.id, credentials[i]!.hash],
          );
          await recordAudit(client, {
            actorUserId: req.authUser!.userId,
            actorRole: "ADMIN",
            action: "EMPLOYEE_IMPORTED",
            entityType: "employee",
            entityId: employee.rows[0]!.id,
          });
          created.push({
            employeeId: d.officialEmployeeId,
            temporaryPassword: credentials[i]!.password,
          });
        }
        await client.query("COMMIT");
        res.status(201).json({ count: created.length, credentials: created });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        next(error);
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/admin/data/audit",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .safeParse(req.query.page ?? 1);
    if (!page.success) {
      res.status(400).json(bad("Invalid page."));
      return;
    }
    try {
      const result = await pool.query(
        `SELECT id, actor_role AS "actorRole", action, entity_type AS "entityType", entity_id AS "entityId", field_key AS "fieldKey", occurred_at AS "occurredAt", reason FROM audit_logs ORDER BY occurred_at DESC, id DESC LIMIT 50 OFFSET $1`,
        [(page.data - 1) * 50],
      );
      res.json({ items: result.rows, page: page.data });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
