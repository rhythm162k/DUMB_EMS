import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import { requireAuth, requireRootAdmin } from "../auth/middleware.js";
import { recordAudit } from "../audit/audit.js";

const router = Router();
const accessInput = z.discriminatedUnion("accessLevel", [
  z.strictObject({ accessLevel: z.literal("FULL") }),
  z.strictObject({
    accessLevel: z.literal("DEPARTMENT"),
    departmentId: z.string().uuid(),
  }),
  z.strictObject({ accessLevel: z.literal("NONE") }),
]);
router.put(
  "/employees/:employeeId/admin-access",
  requireAuth,
  requireRootAdmin,
  async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const input = accessInput.safeParse(req.body);
    const id = z.string().uuid().safeParse(req.params.employeeId);
    if (!input.success || !id.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Choose full access or department access with a department.",
        },
      });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize assignments, including concurrent attempts to demote the last full admin.
      await client.query("SELECT pg_advisory_xact_lock(734613)");
      const actor = await client.query(
        "SELECT id FROM users WHERE id=$1 AND role='ADMIN' AND admin_scope='FULL' AND is_root AND account_status='ACTIVE' FOR UPDATE",
        [req.authUser!.userId],
      );
      if (!actor.rowCount) {
        await client.query("ROLLBACK");
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message:
              "Only the root administrator can manage administrator access.",
          },
        });
        return;
      }
      const target = (
        await client.query(
          `SELECT u.id, u.role, u.admin_scope, u.is_root, u.administered_department_id, u.account_status, e.employment_status
       FROM users u JOIN employees e ON e.id=u.employee_id WHERE e.id=$1 FOR UPDATE OF e,u`,
          [id.data],
        )
      ).rows[0];
      if (!target) {
        await client.query("ROLLBACK");
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Employee account was not found.",
          },
        });
        return;
      }
      if (target.is_root) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "ROOT_ADMIN_PROTECTED",
            message: "The root administrator's access cannot be changed.",
          },
        });
        return;
      }
      const access = input.data;
      if (
        access.accessLevel !== "NONE" &&
        (target.account_status !== "ACTIVE" ||
          target.employment_status !== "ACTIVE")
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "CONFLICT",
            message:
              "Administrator access requires an active employee account.",
          },
        });
        return;
      }
      const departmentId =
        access.accessLevel === "DEPARTMENT" ? access.departmentId : null;
      if (
        departmentId &&
        !(
          await client.query(
            "SELECT id FROM departments WHERE id=$1 FOR KEY SHARE",
            [departmentId],
          )
        ).rowCount
      ) {
        await client.query("ROLLBACK");
        res.status(400).json({
          error: {
            code: "DEPARTMENT_INVALID",
            message: "The selected department does not exist.",
          },
        });
        return;
      }
      if (target.admin_scope === "FULL" && access.accessLevel !== "FULL") {
        const others = await client.query(
          "SELECT id FROM users WHERE role='ADMIN' AND admin_scope='FULL' AND account_status='ACTIVE' AND id<>$1",
          [target.id],
        );
        if (!others.rowCount) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: {
              code: "ADMIN_ACCOUNT_PROTECTED",
              message: "Keep at least one active full-access administrator.",
            },
          });
          return;
        }
      }
      await client.query(
        "UPDATE users SET role=$2, admin_scope=$3, administered_department_id=$4, updated_at=NOW() WHERE id=$1",
        [
          target.id,
          access.accessLevel === "NONE" ? "EMPLOYEE" : "ADMIN",
          access.accessLevel === "NONE" ? null : access.accessLevel,
          departmentId,
        ],
      );
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "ADMIN_ACCESS_CHANGED",
        entityType: "user",
        entityId: target.id,
        metadata: {
          employeeId: id.data,
          accessLevel: access.accessLevel,
          administeredDepartmentId: departmentId,
          previousAccessLevel: target.admin_scope ?? "NONE",
          previousAdministeredDepartmentId: target.administered_department_id,
        },
      });
      // Remove previews authorized under the previous scope. Sessions reload scope every request.
      await client.query("DELETE FROM import_previews WHERE actor_user_id=$1", [
        target.id,
      ]);
      await client.query("COMMIT");
      res.json({
        accessLevel: access.accessLevel,
        administeredDepartmentId: departmentId,
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
