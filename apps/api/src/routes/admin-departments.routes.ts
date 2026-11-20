import { Router } from "express";
import { recordAudit } from "../audit/audit.js";
import { requireAuth, requireFullAdmin } from "../auth/middleware.js";
import { pool } from "../config/database.js";
import {
  createDepartmentSchema,
  departmentIdParamSchema,
  updateDepartmentSchema,
} from "../departments/schemas.js";
import { validationErrorBody } from "../employees/http.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

type DepartmentRow = {
  id: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  employee_count: number;
};

const DEPARTMENT_SELECT = `
  SELECT d.id, d.name_en, d.name_bn, d.is_active, d.created_at, d.updated_at,
         COUNT(e.id)::int AS employee_count
  FROM departments d
  LEFT JOIN employees e ON e.department_id = d.id`;

function toDepartment(row: DepartmentRow) {
  return {
    id: row.id,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    isActive: row.is_active,
    employeeCount: row.employee_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getDepartment(
  departmentId: string,
): Promise<DepartmentRow | undefined> {
  const result = await pool.query<DepartmentRow>(
    `${DEPARTMENT_SELECT} WHERE d.id = $1 GROUP BY d.id`,
    [departmentId],
  );
  return result.rows[0];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

const nameTaken = {
  error: {
    code: "DEPARTMENT_NAME_TAKEN",
    message: "A department with this English name already exists.",
  },
};
const notFound = {
  error: { code: "DEPARTMENT_NOT_FOUND", message: "Department was not found." },
};

// All departments, including inactive ones, with the number of employees assigned to each.
router.get(
  "/departments",
  requireAuth,
  requireFullAdmin,
  async (_req, res, next) => {
    try {
      const result = await pool.query<DepartmentRow>(
        `${DEPARTMENT_SELECT} GROUP BY d.id ORDER BY d.name_en ASC`,
      );
      res.status(200).json({ departments: result.rows.map(toDepartment) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/departments",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    const parsed = createDepartmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(validationErrorBody(parsed.error));
      return;
    }
    const admin = req.authUser;
    if (!admin) {
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO departments (name_en, name_bn) VALUES ($1, $2) RETURNING id",
        [parsed.data.nameEn, parsed.data.nameBn],
      );
      const departmentId = inserted.rows[0]?.id;
      if (!departmentId)
        throw new Error("Department insert did not return an id.");
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "DEPARTMENT_CREATED",
        entityType: "department",
        entityId: departmentId,
      });
      await client.query("COMMIT");

      const created = await getDepartment(departmentId);
      res
        .status(201)
        .json({ department: created ? toDepartment(created) : null });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(error)) {
        res.status(409).json(nameTaken);
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

// Rename, change the Bangla name, or activate/deactivate. Deactivating hides the
// department from dropdowns and new assignments; existing employees keep it.
router.patch(
  "/departments/:departmentId",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    const params = departmentIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Department ID is invalid.",
        },
      });
      return;
    }
    const body = updateDepartmentSchema.safeParse(req.body);
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

    const { departmentId } = params.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{
        name_en: string;
        name_bn: string | null;
        is_active: boolean;
      }>(
        "SELECT name_en, name_bn, is_active FROM departments WHERE id = $1 FOR UPDATE",
        [departmentId],
      );
      const existing = current.rows[0];
      if (!existing) {
        await client.query("ROLLBACK");
        res.status(404).json(notFound);
        return;
      }

      const nextNameEn = body.data.nameEn ?? existing.name_en;
      const nextNameBn =
        body.data.nameBn === undefined
          ? existing.name_bn
          : body.data.nameBn || null;
      const nextActive = body.data.isActive ?? existing.is_active;

      const changedFields: string[] = [];
      if (nextNameEn !== existing.name_en) changedFields.push("nameEn");
      if (nextNameBn !== existing.name_bn) changedFields.push("nameBn");
      if (nextActive !== existing.is_active) changedFields.push("isActive");

      if (changedFields.length === 0) {
        await client.query("ROLLBACK");
        const unchanged = await getDepartment(departmentId);
        res.status(200).json({
          changed: false,
          department: unchanged ? toDepartment(unchanged) : null,
        });
        return;
      }

      await client.query(
        "UPDATE departments SET name_en = $1, name_bn = $2, is_active = $3, updated_at = NOW() WHERE id = $4",
        [nextNameEn, nextNameBn, nextActive, departmentId],
      );
      await recordAudit(client, {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "DEPARTMENT_UPDATED",
        entityType: "department",
        entityId: departmentId,
        metadata: {
          changedFields,
          ...(nextActive !== existing.is_active
            ? { isActive: { from: existing.is_active, to: nextActive } }
            : {}),
        },
      });
      await client.query("COMMIT");

      const updated = await getDepartment(departmentId);
      res.status(200).json({
        changed: true,
        department: updated ? toDepartment(updated) : null,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (isUniqueViolation(error)) {
        res.status(409).json(nameTaken);
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);

export default router;
