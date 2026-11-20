import { assertEmployeeAccess } from "../auth/scope.js";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit/audit.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { pool } from "../config/database.js";
import { validationErrorBody } from "../employees/http.js";
import {
  currentValues,
  getRecord,
  listSectionRecords,
  lockRecord,
  toRecordJson,
} from "../records/repository.js";
import {
  RECORD_SECTIONS_BY_SLUG,
  dateRangeProblem,
  normalizeRecordValue,
  type RecordSection,
} from "../records/sections.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const collectionParams = z.object({
  employeeId: z.string().uuid(),
  section: z.string().min(1).max(50),
});
const itemParams = collectionParams.extend({ recordId: z.string().uuid() });

const invalidPath = {
  error: {
    code: "VALIDATION_ERROR",
    message: "The request path contains an invalid ID.",
  },
};
const sectionNotFound = {
  error: { code: "SECTION_NOT_FOUND", message: "Unknown record section." },
};
const employeeNotFound = {
  error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee was not found." },
};
const recordNotFound = {
  error: {
    code: "RECORD_NOT_FOUND",
    message: "Record was not found for this employee.",
  },
};
const unauthenticated = {
  error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
};

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function constraintResponse(error: unknown) {
  const code = postgresCode(error);
  if (code === "23503") {
    return {
      error: {
        code: "DEPARTMENT_INVALID",
        message: "The selected department was not found.",
      },
    };
  }
  if (code === "23514") {
    return {
      error: {
        code: "VALIDATION_ERROR",
        message: "The submitted data violates a record rule.",
      },
    };
  }
  return undefined;
}

function rangeErrorBody(message: string) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message,
    },
  };
}

function lookupSection(slug: string): RecordSection | undefined {
  return RECORD_SECTIONS_BY_SLUG.get(slug);
}

async function employeeExists(employeeId: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM employees WHERE id = $1", [
    employeeId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

router.get(
  "/employees/:employeeId/records/:section",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const params = collectionParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json(invalidPath);
        return;
      }
      const section = lookupSection(params.data.section);
      if (!section) {
        res.status(404).json(sectionNotFound);
        return;
      }
      if (!(await employeeExists(params.data.employeeId))) {
        res.status(404).json(employeeNotFound);
        return;
      }
      res.status(200).json({
        items: await listSectionRecords(section, params.data.employeeId),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/employees/:employeeId/records/:section",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = collectionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidPath);
      return;
    }
    const section = lookupSection(params.data.section);
    if (!section) {
      res.status(404).json(sectionNotFound);
      return;
    }
    const body = section.createSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(validationErrorBody(body.error));
      return;
    }
    const admin = req.authUser;
    if (!admin) {
      res.status(401).json(unauthenticated);
      return;
    }

    const input = body.data as Record<string, unknown>;
    const rangeProblem = dateRangeProblem(section, input);
    if (rangeProblem) {
      res.status(400).json(rangeErrorBody(rangeProblem));
      return;
    }

    const { employeeId } = params.data;
    const columns: string[] = ["employee_id"];
    const values: unknown[] = [employeeId];
    for (const field of section.fields) {
      const raw = input[field.key];
      if (raw === undefined) continue;
      columns.push(field.column);
      values.push(normalizeRecordValue(raw));
    }
    const placeholders = values
      .map((_value, index) => `$${index + 1}`)
      .join(", ");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);
      const employee = await client.query(
        "SELECT 1 FROM employees WHERE id = $1 FOR SHARE",
        [employeeId],
      );
      if (!employee.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(employeeNotFound);
        return;
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ${section.table} (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        values,
      );
      const recordId = inserted.rows[0]?.id;
      if (!recordId) throw new Error("Record insert did not return an id.");

      // Metadata names the section and employee only; field values are never written to the audit log.
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_RECORD_CREATED",
        entityType: section.table,
        entityId: recordId,
        metadata: { employeeId, section: section.slug },
      });
      await client.query("COMMIT");

      res
        .status(201)
        .json({ record: await getRecord(section, employeeId, recordId) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = constraintResponse(error);
      if (mapped) {
        res.status(400).json(mapped);
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

router.patch(
  "/employees/:employeeId/records/:section/:recordId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidPath);
      return;
    }
    const section = lookupSection(params.data.section);
    if (!section) {
      res.status(404).json(sectionNotFound);
      return;
    }
    const body = section.updateSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(validationErrorBody(body.error));
      return;
    }
    const admin = req.authUser;
    if (!admin) {
      res.status(401).json(unauthenticated);
      return;
    }

    const input = body.data as Record<string, unknown>;
    const { employeeId, recordId } = params.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);
      const row = await lockRecord(client, section, employeeId, recordId);
      if (!row) {
        await client.query("ROLLBACK");
        res.status(404).json(recordNotFound);
        return;
      }

      const current = currentValues(section, row);
      const changes: Array<{ key: string; column: string; value: unknown }> =
        [];
      for (const field of section.fields) {
        const raw = input[field.key];
        if (raw === undefined) continue;
        const value = normalizeRecordValue(raw);
        if (value !== current[field.key])
          changes.push({ key: field.key, column: field.column, value });
      }

      if (changes.length === 0) {
        await client.query("ROLLBACK");
        res
          .status(200)
          .json({ changed: false, record: toRecordJson(section, row) });
        return;
      }

      // Validate the date order against the merged result, not just the submitted fields.
      const merged = { ...current };
      for (const change of changes) merged[change.key] = change.value;
      const rangeProblem = dateRangeProblem(section, merged);
      if (rangeProblem) {
        await client.query("ROLLBACK");
        res.status(400).json(rangeErrorBody(rangeProblem));
        return;
      }

      const assignments = changes.map(
        (change, index) => `${change.column} = $${index + 1}`,
      );
      const values: unknown[] = changes.map((change) => change.value);
      values.push(recordId, employeeId);
      await client.query(
        `UPDATE ${section.table}
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${changes.length + 1} AND employee_id = $${changes.length + 2}`,
        values,
      );
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_RECORD_UPDATED",
        entityType: section.table,
        entityId: recordId,
        metadata: {
          employeeId,
          section: section.slug,
          changedFields: changes.map((change) => change.key),
        },
      });
      await client.query("COMMIT");

      res.status(200).json({
        changed: true,
        record: await getRecord(section, employeeId, recordId),
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const mapped = constraintResponse(error);
      if (mapped) {
        res.status(400).json(mapped);
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

router.delete(
  "/employees/:employeeId/records/:section/:recordId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(invalidPath);
      return;
    }
    const section = lookupSection(params.data.section);
    if (!section) {
      res.status(404).json(sectionNotFound);
      return;
    }
    const admin = req.authUser;
    if (!admin) {
      res.status(401).json(unauthenticated);
      return;
    }

    const { employeeId, recordId } = params.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        employeeId,
      ]);
      await assertEmployeeAccess(admin, employeeId, client);
      const deleted = await client.query(
        `DELETE FROM ${section.table} WHERE id = $1 AND employee_id = $2 RETURNING id`,
        [recordId, employeeId],
      );
      if (!deleted.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(recordNotFound);
        return;
      }
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "EMPLOYEE_RECORD_DELETED",
        entityType: section.table,
        entityId: recordId,
        metadata: { employeeId, section: section.slug },
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
