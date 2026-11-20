import { assertEmployeeAccess } from "../auth/scope.js";
import { Router } from "express";
import { recordAudit } from "../audit/audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { employeeIdParamSchema } from "../auth/schemas.js";
import { pool } from "../config/database.js";
import { validationErrorBody } from "../employees/http.js";
import {
  SPOUSE_SELECT,
  getSpouse,
  type SpouseRow,
} from "../spouse/repository.js";
import { upsertSpouseSchema } from "../spouse/schemas.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const invalidEmployeeId = {
  error: { code: "VALIDATION_ERROR", message: "Employee ID is invalid." },
};
const employeeNotFound = {
  error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee was not found." },
};
const spouseNotFound = {
  error: {
    code: "SPOUSE_NOT_FOUND",
    message: "This employee has no spouse record.",
  },
};

router.get(
  "/employees/:employeeId/spouse",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = employeeIdParamSchema.safeParse(req.params);
      if (!params.success) {
        res.status(400).json(invalidEmployeeId);
        return;
      }
      const employee = await pool.query(
        "SELECT 1 FROM employees WHERE id = $1",
        [params.data.employeeId],
      );
      if (!employee.rowCount) {
        res.status(404).json(employeeNotFound);
        return;
      }
      res.status(200).json({ spouse: await getSpouse(params.data.employeeId) });
    } catch (error) {
      next(error);
    }
  },
);

// Create or replace the (single) spouse record. 201 when created, 200 when it already existed.
router.put(
  "/employees/:employeeId/spouse",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidEmployeeId);
      return;
    }
    const body = upsertSpouseSchema.safeParse(req.body);
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
    const input = body.data;
    const submitted: Record<string, string | null> = {
      spouseName: input.spouseName,
      spouseOccupation: input.spouseOccupation,
      spouseDateOfBirth: input.spouseDateOfBirth,
      spouseNationalId: input.spouseNationalId,
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);

      // Locking the employee row serializes concurrent spouse writes for the same employee.
      const employee = await client.query<{ marital_status: string | null }>(
        "SELECT marital_status FROM employees WHERE id = $1 FOR UPDATE",
        [employeeId],
      );
      if (!employee.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(employeeNotFound);
        return;
      }
      if (employee.rows[0]?.marital_status !== "MARRIED") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "SPOUSE_REQUIRES_MARRIED",
            message:
              "Set the marital status to Married before adding spouse information.",
          },
        });
        return;
      }

      const existing = await client.query<SpouseRow>(
        `SELECT ${SPOUSE_SELECT} FROM employee_spouse WHERE employee_id = $1 FOR UPDATE`,
        [employeeId],
      );
      const current = existing.rows[0];

      if (!current) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO employee_spouse (employee_id, spouse_name, spouse_occupation, spouse_date_of_birth, spouse_national_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            employeeId,
            submitted.spouseName,
            submitted.spouseOccupation,
            submitted.spouseDateOfBirth,
            submitted.spouseNationalId,
          ],
        );
        const spouseId = inserted.rows[0]?.id;
        if (!spouseId) throw new Error("Spouse insert did not return an id.");
        // Audit records the employee and event only; spouse values (including NID) are never logged.
        await recordAudit(client, {
          actorUserId: admin.userId,
          actorRole: admin.role,
          action: "EMPLOYEE_SPOUSE_CREATED",
          entityType: "employee_spouse",
          entityId: spouseId,
          metadata: { employeeId },
        });
        await client.query("COMMIT");
        res
          .status(201)
          .json({ changed: true, spouse: await getSpouse(employeeId) });
        return;
      }

      const stored: Record<string, string | null> = {
        spouseName: current.spouse_name,
        spouseOccupation: current.spouse_occupation,
        spouseDateOfBirth: current.spouse_date_of_birth,
        spouseNationalId: current.spouse_national_id,
      };
      const changedFields = Object.keys(submitted).filter(
        (key) => submitted[key] !== stored[key],
      );
      if (changedFields.length === 0) {
        await client.query("ROLLBACK");
        res
          .status(200)
          .json({ changed: false, spouse: await getSpouse(employeeId) });
        return;
      }

      await client.query(
        `UPDATE employee_spouse
       SET spouse_name = $1, spouse_occupation = $2, spouse_date_of_birth = $3, spouse_national_id = $4,
           updated_at = NOW()
       WHERE id = $5`,
        [
          submitted.spouseName,
          submitted.spouseOccupation,
          submitted.spouseDateOfBirth,
          submitted.spouseNationalId,
          current.id,
        ],
      );
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_SPOUSE_UPDATED",
        entityType: "employee_spouse",
        entityId: current.id,
        metadata: { employeeId, changedFields },
      });
      await client.query("COMMIT");
      res
        .status(200)
        .json({ changed: true, spouse: await getSpouse(employeeId) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

router.delete(
  "/employees/:employeeId/spouse",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidEmployeeId);
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);
      const deleted = await client.query<{ id: string }>(
        "DELETE FROM employee_spouse WHERE employee_id = $1 RETURNING id",
        [employeeId],
      );
      const spouseId = deleted.rows[0]?.id;
      if (!spouseId) {
        await client.query("ROLLBACK");
        res.status(404).json(spouseNotFound);
        return;
      }
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_SPOUSE_DELETED",
        entityType: "employee_spouse",
        entityId: spouseId,
        metadata: { employeeId },
      });
      await client.query("COMMIT");
      res.status(200).json({ deleted: true });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

export default router;
