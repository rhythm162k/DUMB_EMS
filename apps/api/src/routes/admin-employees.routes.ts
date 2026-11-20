import { departmentScope, assertEmployeeAccess } from "../auth/scope.js";
import bcrypt from "bcrypt";
import { Router } from "express";
import { recordAudit } from "../audit/audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { employeeIdParamSchema } from "../auth/schemas.js";
import { generateTemporaryPassword } from "../auth/security.js";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { validationErrorBody } from "../employees/http.js";
import { getEmployeeDetail, listEmployees } from "../employees/repository.js";
import {
  createEmployeeSchema,
  employeeListQuerySchema,
  updateEmployeeSchema,
  updateStatusSchema,
} from "../employees/schemas.js";
import {
  toAdminEmployeeDetail,
  toEmployeeListItem,
} from "../employees/serializers.js";
import {
  EMPLOYEE_UPDATE_FIELDS,
  EMPLOYEE_UPDATE_SELECT,
  normalizeUpdateValue,
} from "../employees/updates.js";
import { listAllRecords } from "../records/repository.js";
import { getSpouse } from "../spouse/repository.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const invalidEmployeeId = {
  error: { code: "VALIDATION_ERROR", message: "Employee ID is invalid." },
};
const notFound = {
  error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee was not found." },
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

// List, search, filter and paginate employee records.
router.get(
  "/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const parsed = employeeListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            validationErrorBody(
              parsed.error,
              "The search filters are invalid.",
            ),
          );
        return;
      }

      const { rows, total } = await listEmployees(
        parsed.data,
        departmentScope(req.authUser!),
      );
      res.status(200).json({
        items: rows.map(toEmployeeListItem),
        pagination: {
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Create an employee record and its login account in one transaction.
router.post(
  "/employees",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error));
      return;
    }

    const data = parsed.data;
    const admin = req.authUser;
    if (!admin) {
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
      });
      return;
    }

    // Hash before opening the transaction so the connection is not held during bcrypt work.
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_COST);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const department = await client.query(
        "SELECT 1 FROM departments WHERE id = $1 AND is_active = TRUE",
        [data.departmentId],
      );
      if (!department.rowCount) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: {
            code: "DEPARTMENT_INVALID",
            message: "The selected department was not found or is inactive.",
          },
        });
        return;
      }

      const employee = await client.query<{ id: string }>(
        `INSERT INTO employees (
         official_employee_id, department_id, employment_status,
         first_name_en, last_name_en, full_name_bn,
         date_of_birth, gender, blood_group, national_id, phone, email,
         designation, joining_date, father_name, mother_name, religion, marital_status,
         created_by, updated_by
       ) VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
       RETURNING id`,
        [
          data.officialEmployeeId,
          data.departmentId,
          data.firstNameEn,
          data.lastNameEn,
          data.fullNameBn,
          data.dateOfBirth,
          data.gender,
          data.bloodGroup,
          data.nationalId,
          data.phone,
          data.email,
          data.designation,
          data.joiningDate,
          data.fatherName,
          data.motherName,
          data.religion,
          data.maritalStatus,
          admin.userId,
        ],
      );
      const employeeRecordId = employee.rows[0]?.id;
      if (!employeeRecordId)
        throw new Error("Employee insert did not return an id.");

      await client.query(
        `INSERT INTO users (employee_id, password_hash, role, account_status, must_change_password)
       VALUES ($1, $2, 'EMPLOYEE', 'ACTIVE', TRUE)`,
        [employeeRecordId, passwordHash],
      );

      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_CREATED",
        entityType: "employee",
        entityId: employeeRecordId,
      });

      await client.query("COMMIT");

      const created = await getEmployeeDetail(employeeRecordId);
      res.status(201).json({
        employee: created ? toAdminEmployeeDetail(created) : null,
        temporaryPassword,
        message:
          "Copy this temporary password now. It will not be shown again.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(error)) {
        res.status(409).json({
          error: {
            code: "EMPLOYEE_ID_TAKEN",
            message: "An employee with this ID already exists.",
          },
        });
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

router.get(
  "/employees/:employeeId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const parsed = employeeIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json(invalidEmployeeId);
        return;
      }

      const employee = await getEmployeeDetail(parsed.data.employeeId);
      if (!employee) {
        res.status(404).json(notFound);
        return;
      }
      // `records` holds the repeatable PDS sections (qualifications, training, and so on).
      res.status(200).json({
        employee: toAdminEmployeeDetail(employee),
        records: await listAllRecords(employee.id),
        spouse: await getSpouse(employee.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

// Directly edit the employee's profile fields. Only the keys in EMPLOYEE_UPDATE_FIELDS can be
// changed; the official employee ID, employment/account status and role cannot be sent here.
router.patch(
  "/employees/:employeeId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidEmployeeId);
      return;
    }

    // Checked before schema validation so the client gets a specific, explicit answer.
    if (
      typeof req.body === "object" &&
      req.body !== null &&
      "officialEmployeeId" in req.body
    ) {
      res.status(400).json({
        error: {
          code: "EMPLOYEE_ID_IMMUTABLE",
          message: "The official employee ID cannot be changed.",
        },
      });
      return;
    }
    const body = updateEmployeeSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(validationErrorBody(body.error));
      return;
    }

    const admin = req.authUser;
    if (!admin) {
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
      });
      return;
    }

    const { employeeId } = params.data;
    const input = body.data as Record<string, unknown>;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);

      // Lock the row so concurrent edits are applied one after another.
      const currentResult = await client.query<Record<string, string | null>>(
        `SELECT ${EMPLOYEE_UPDATE_SELECT} FROM employees WHERE id = $1 FOR UPDATE`,
        [employeeId],
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        res.status(404).json(notFound);
        return;
      }

      const changes: Array<{ key: string; column: string; value: unknown }> =
        [];
      for (const field of EMPLOYEE_UPDATE_FIELDS) {
        const raw = input[field.key];
        if (raw === undefined) continue;
        const value = normalizeUpdateValue(raw);
        if (value !== (current[field.column] ?? null))
          changes.push({ key: field.key, column: field.column, value });
      }

      if (changes.length === 0) {
        await client.query("ROLLBACK");
        const unchanged = await getEmployeeDetail(employeeId);
        res.status(200).json({
          changed: false,
          employee: unchanged ? toAdminEmployeeDetail(unchanged) : null,
        });
        return;
      }

      // A department can only be assigned if it exists and is active. An unchanged department is
      // not re-checked, so editing other fields still works after a department is deactivated.
      const departmentChange = changes.find(
        (change) => change.key === "departmentId",
      );
      if (departmentChange) {
        const department = await client.query(
          "SELECT 1 FROM departments WHERE id = $1 AND is_active = TRUE",
          [departmentChange.value],
        );
        if (!department.rowCount) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: {
              code: "DEPARTMENT_INVALID",
              message: "The selected department was not found or is inactive.",
            },
          });
          return;
        }
      }

      // A spouse record only makes sense while the employee is MARRIED. Remove the spouse record first.
      const maritalChange = changes.find(
        (change) => change.key === "maritalStatus",
      );
      if (maritalChange && maritalChange.value !== "MARRIED") {
        const spouse = await client.query(
          "SELECT 1 FROM employee_spouse WHERE employee_id = $1",
          [employeeId],
        );
        if (spouse.rowCount) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: {
              code: "SPOUSE_RECORD_EXISTS",
              message:
                "Remove the spouse record before changing the marital status from Married.",
            },
          });
          return;
        }
      }

      const assignments = changes.map(
        (change, index) => `${change.column} = $${index + 1}`,
      );
      const values: unknown[] = changes.map((change) => change.value);
      values.push(admin.userId, employeeId);
      await client.query(
        `UPDATE employees
       SET ${assignments.join(", ")}, updated_at = NOW(), updated_by = $${changes.length + 1}
       WHERE id = $${changes.length + 2}`,
        values,
      );

      // Field names only. Old and new values (NID, phone, address...) never go into the audit log.
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_UPDATED",
        entityType: "employee",
        entityId: employeeId,
        metadata: { changedFields: changes.map((change) => change.key) },
      });
      await client.query("COMMIT");

      const updated = await getEmployeeDetail(employeeId);
      res.status(200).json({
        changed: true,
        employee: updated ? toAdminEmployeeDetail(updated) : null,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

// Change employment and/or account status. Moving an employee to a non-active
// employment status disables the account and revokes sessions (blueprint 4.5).
router.patch(
  "/employees/:employeeId/status",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidEmployeeId);
      return;
    }
    const body = updateStatusSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(validationErrorBody(body.error));
      return;
    }

    const admin = req.authUser;
    if (!admin) {
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
      });
      return;
    }

    const { employeeId } = params.data;
    const { employmentStatus, accountStatus, reason } = body.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);

      // Serialize concurrent status changes for the same employee.
      const employeeRow = await client.query<{ employment_status: string }>(
        "SELECT employment_status FROM employees WHERE id = $1 FOR UPDATE",
        [employeeId],
      );
      const currentEmployment = employeeRow.rows[0]?.employment_status;
      if (!currentEmployment) {
        await client.query("ROLLBACK");
        res.status(404).json(notFound);
        return;
      }

      const userRow = await client.query<{
        id: string;
        role: "ADMIN" | "EMPLOYEE";
        account_status: string;
      }>(
        "SELECT id, role, account_status FROM users WHERE employee_id = $1 FOR UPDATE",
        [employeeId],
      );
      const account = userRow.rows[0];

      // Root and full-access administrators may change anyone's employment and account
      // status, including department administrators. The root account is already refused
      // for everyone else by assertEmployeeAccess above. Nobody changes their own status
      // here, so an administrator cannot lock themselves out.
      if (
        employeeId === admin.employeeRecordId ||
        account?.id === admin.userId
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "ADMIN_ACCOUNT_PROTECTED",
            message: "You cannot change your own employment or account status.",
          },
        });
        return;
      }
      if (!account && accountStatus !== undefined) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "NO_ACCOUNT",
            message: "This employee does not have a login account.",
          },
        });
        return;
      }

      const nextEmployment = employmentStatus ?? currentEmployment;
      let nextAccount = accountStatus ?? account?.account_status;
      if (
        account &&
        accountStatus === undefined &&
        nextEmployment !== "ACTIVE" &&
        account.account_status === "ACTIVE"
      ) {
        nextAccount = "DISABLED";
      }
      if (account && nextEmployment !== "ACTIVE" && nextAccount === "ACTIVE") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "STATUS_CONFLICT",
            message:
              "An account cannot be active while the employee's employment status is not active.",
          },
        });
        return;
      }

      const employmentChanged = nextEmployment !== currentEmployment;
      const accountChanged =
        account !== undefined && nextAccount !== account.account_status;
      if (!employmentChanged && !accountChanged) {
        await client.query("ROLLBACK");
        const current = await getEmployeeDetail(employeeId);
        res.status(200).json({
          changed: false,
          employee: current ? toAdminEmployeeDetail(current) : null,
        });
        return;
      }

      if (employmentChanged) {
        await client.query(
          "UPDATE employees SET employment_status = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3",
          [nextEmployment, admin.userId, employeeId],
        );
      }
      if (account && accountChanged) {
        await client.query(
          "UPDATE users SET account_status = $1, updated_at = NOW() WHERE id = $2",
          [nextAccount, account.id],
        );
      }

      // Any non-active result ends existing sessions immediately.
      const accessEnded =
        account !== undefined &&
        (nextAccount !== "ACTIVE" || nextEmployment !== "ACTIVE");
      if (account && accessEnded) {
        await client.query(
          "DELETE FROM \"session\" WHERE sess ->> 'userId' = $1",
          [account.id],
        );
      }

      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_STATUS_CHANGED",
        entityType: "employee",
        entityId: employeeId,
        fieldKey: "status",
        reason: reason ?? null,
        metadata: {
          ...(employmentChanged
            ? {
                employmentStatus: {
                  from: currentEmployment,
                  to: nextEmployment,
                },
              }
            : {}),
          ...(accountChanged
            ? {
                accountStatus: {
                  from: account?.account_status,
                  to: nextAccount,
                },
              }
            : {}),
          sessionsRevoked: accessEnded,
        },
      });

      await client.query("COMMIT");

      const updated = await getEmployeeDetail(employeeId);
      res.status(200).json({
        changed: true,
        employee: updated ? toAdminEmployeeDetail(updated) : null,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

export default router;
