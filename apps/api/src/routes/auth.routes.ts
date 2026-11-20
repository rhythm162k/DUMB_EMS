import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import {
  requireAuth,
  requireFirstLoginPasswordChange,
  requirePasswordChangeComplete,
} from "../auth/middleware.js";
import {
  changePasswordSchema,
  firstLoginPasswordSchema,
  loginSchema,
} from "../auth/schemas.js";
import {
  createCsrfToken,
  destroySession,
  regenerateSession,
  saveSession,
} from "../auth/security.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const dummyPasswordHashPromise = bcrypt.hash(
  randomBytes(32).toString("hex"),
  env.BCRYPT_COST,
);

// Only failed attempts count. Office staff often share one public IP (NAT), so
// counting successful sign-ins would lock everyone out after ten logins.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "LOGIN_RATE_LIMITED",
      message: "Too many sign-in attempts. Try again later.",
    },
  },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "PASSWORD_RATE_LIMITED",
      message: "Too many password changes. Try again later.",
    },
  },
});

function validationError(message: string) {
  return { error: { code: "VALIDATION_ERROR", message } };
}

function publicUser(user: {
  user_id: string;
  role: "ADMIN" | "EMPLOYEE";
  admin_scope: "FULL" | "DEPARTMENT" | null;
  is_root: boolean;
  administered_department_id: string | null;
  must_change_password: boolean;
  employee_record_id: string | null;
  employee_id: string | null;
  first_name: string | null;
  last_name: string | null;
  employment_status: string | null;
}) {
  return {
    id: user.user_id,
    role: user.role,
    adminScope: user.admin_scope,
    isRoot: user.is_root,
    administeredDepartmentId: user.administered_department_id,
    mustChangePassword: user.must_change_password,
    employeeRecordId: user.employee_record_id,
    employeeId: user.employee_id,
    firstName: user.first_name,
    lastName: user.last_name,
    employmentStatus: user.employment_status,
  };
}

router.get("/csrf", async (req, res, next) => {
  try {
    if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
    await saveSession(req);
    res.status(200).json({ csrfToken: req.session.csrfToken });
  } catch (error) {
    next(error);
  }
});

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(validationError("Enter a valid employee ID and password."));
      return;
    }

    const result = await pool.query<{
      user_id: string;
      password_hash: string;
      role: "ADMIN" | "EMPLOYEE";
      admin_scope: "FULL" | "DEPARTMENT" | null;
      is_root: boolean;
      administered_department_id: string | null;
      account_status: string;
      must_change_password: boolean;
      employee_record_id: string | null;
      employee_id: string | null;
      first_name: string | null;
      last_name: string | null;
      employment_status: string | null;
    }>(
      `SELECT
         u.id AS user_id,
         u.password_hash,
         u.role, u.admin_scope, u.is_root, u.administered_department_id,
         u.account_status,
         u.must_change_password,
         e.id AS employee_record_id,
         e.official_employee_id AS employee_id,
         e.first_name_en AS first_name,
         e.last_name_en AS last_name,
         e.employment_status
       FROM employees e
       INNER JOIN users u ON u.employee_id = e.id
       WHERE e.official_employee_id = $1
       LIMIT 1`,
      [parsed.data.employeeId],
    );

    const user = result.rows[0];
    const hashToCompare =
      user?.password_hash ?? (await dummyPasswordHashPromise);
    const passwordMatches = await bcrypt.compare(
      parsed.data.password,
      hashToCompare,
    );

    // Keep the public response identical for unknown IDs, wrong passwords and inactive accounts.
    if (
      !user ||
      !passwordMatches ||
      user.account_status !== "ACTIVE" ||
      (user.employee_record_id && user.employment_status !== "ACTIVE")
    ) {
      res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Employee ID or password is incorrect.",
        },
      });
      return;
    }

    await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.user_id,
    ]);
    await regenerateSession(req);
    req.session.userId = user.user_id;
    req.session.csrfToken = createCsrfToken();
    await saveSession(req);

    res
      .status(200)
      .json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({
      error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
    });
    return;
  }

  res.status(200).json({
    user: {
      id: user.userId,
      role: user.role,
      adminScope: user.adminScope,
      isRoot: user.isRoot,
      administeredDepartmentId: user.administeredDepartmentId,
      mustChangePassword: user.mustChangePassword,
      employeeRecordId: user.employeeRecordId,
      employeeId: user.employeeId,
      firstName: user.firstName,
      lastName: user.lastName,
      employmentStatus: user.employmentStatus,
    },
  });
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie("ems.sid", {
      httpOnly: true,
      secure: env.SESSION_COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
    });
    res.status(200).json({ message: "Signed out successfully." });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/first-login/change-password",
  requireAuth,
  requireFirstLoginPasswordChange,
  passwordChangeLimiter,
  async (req, res, next) => {
    try {
      const parsed = firstLoginPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            validationError(
              parsed.error.issues[0]?.message ?? "Enter a valid new password.",
            ),
          );
        return;
      }

      const user = req.authUser;
      if (!user) {
        res.status(401).json({
          error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
        });
        return;
      }

      const passwordHash = await bcrypt.hash(
        parsed.data.newPassword,
        env.BCRYPT_COST,
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE users
           SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
           WHERE id = $2`,
          [passwordHash, user.userId],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, 'PASSWORD_CHANGED', 'user', $1, '{}'::jsonb)`,
          [user.userId, user.role],
        );
        await client.query(
          "DELETE FROM \"session\" WHERE sess ->> 'userId' = $1",
          [user.userId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await regenerateSession(req);
      req.session.userId = user.userId;
      req.session.csrfToken = createCsrfToken();
      await saveSession(req);
      res.status(200).json({
        message: "Password changed successfully.",
        csrfToken: req.session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/change-password",
  requireAuth,
  requirePasswordChangeComplete,
  passwordChangeLimiter,
  async (req, res, next) => {
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            validationError(
              parsed.error.issues[0]?.message ??
                "Enter valid password details.",
            ),
          );
        return;
      }

      const user = req.authUser;
      if (!user) {
        res.status(401).json({
          error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
        });
        return;
      }

      const existing = await pool.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1",
        [user.userId],
      );
      const passwordMatches = existing.rows[0]
        ? await bcrypt.compare(
            parsed.data.currentPassword,
            existing.rows[0].password_hash,
          )
        : false;
      if (!passwordMatches) {
        res.status(400).json({
          error: {
            code: "CURRENT_PASSWORD_INVALID",
            message: "Current password is incorrect.",
          },
        });
        return;
      }

      const passwordHash = await bcrypt.hash(
        parsed.data.newPassword,
        env.BCRYPT_COST,
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [passwordHash, user.userId],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, 'PASSWORD_CHANGED', 'user', $1, '{}'::jsonb)`,
          [user.userId, user.role],
        );
        await client.query(
          "DELETE FROM \"session\" WHERE sess ->> 'userId' = $1",
          [user.userId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await regenerateSession(req);
      req.session.userId = user.userId;
      req.session.csrfToken = createCsrfToken();
      await saveSession(req);
      res.status(200).json({
        message: "Password changed successfully.",
        csrfToken: req.session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
