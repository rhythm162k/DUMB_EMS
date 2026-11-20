import { assertEmployeeAccess } from "../auth/scope.js";
import bcrypt from "bcrypt";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  requireAuth,
  requirePasswordChangeComplete,
  requireRole,
} from "../auth/middleware.js";
import { employeeIdParamSchema } from "../auth/schemas.js";
import { generateTemporaryPassword } from "../auth/security.js";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RESET_RATE_LIMITED",
      message: "Too many password resets. Try again later.",
    },
  },
});

router.post(
  "/employees/:employeeId/password-reset",
  requireAuth,
  requirePasswordChangeComplete,
  requireRole("ADMIN"),
  resetLimiter,
  async (req, res, next) => {
    const parsed = employeeIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Employee ID is invalid.",
        },
      });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        parsed.data.employeeId,
      ]);
      await assertEmployeeAccess(req.authUser!, parsed.data.employeeId, client);
      const target = await client.query<{
        user_id: string;
        employment_status: string;
        account_status: string;
      }>(
        `SELECT u.id AS user_id, e.employment_status, u.account_status
         FROM users u
         INNER JOIN employees e ON e.id = u.employee_id
         WHERE u.employee_id = $1 AND u.role = 'EMPLOYEE'
         FOR UPDATE OF u`,
        [parsed.data.employeeId],
      );
      const targetUser = target.rows[0];
      if (!targetUser) {
        await client.query("ROLLBACK");
        res.status(404).json({
          error: {
            code: "EMPLOYEE_ACCOUNT_NOT_FOUND",
            message: "Employee account was not found.",
          },
        });
        return;
      }

      if (targetUser.employment_status !== "ACTIVE") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "EMPLOYEE_NOT_ACTIVE",
            message:
              "Only active employees can receive a new temporary password.",
          },
        });
        return;
      }

      // A reset must not silently re-enable a disabled or locked account.
      if (targetUser.account_status !== "ACTIVE") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "ACCOUNT_NOT_ACTIVE",
            message:
              "Enable the account before issuing a new temporary password.",
          },
        });
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(
        temporaryPassword,
        env.BCRYPT_COST,
      );
      await client.query(
        `UPDATE users
         SET password_hash = $1, must_change_password = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, targetUser.user_id],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
         VALUES ($1, 'ADMIN', 'EMPLOYEE_PASSWORD_RESET', 'user', $2, '{}'::jsonb)`,
        [req.authUser?.userId, targetUser.user_id],
      );
      await client.query(
        "DELETE FROM \"session\" WHERE sess ->> 'userId' = $1",
        [targetUser.user_id],
      );
      await client.query("COMMIT");
      res.status(200).json({
        employeeRecordId: parsed.data.employeeId,
        temporaryPassword,
        mustChangePassword: true,
        message:
          "Copy this temporary password now. It will not be shown again.",
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
