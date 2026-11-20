import type { NextFunction, Request, Response } from "express";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import type { Role } from "./constants.js";
import {
  authorizeAdminRequest,
  canAccessEmployee,
  isFullAdmin,
  isRootAdmin,
} from "./scope.js";
import type { AuthenticatedUser } from "./types.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({
      error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
    });
    return;
  }

  try {
    const result = await pool.query<{
      user_id: string;
      role: Role;
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
         u.role, u.admin_scope, u.is_root, u.administered_department_id,
         u.account_status,
         u.must_change_password,
         e.id AS employee_record_id,
         e.official_employee_id AS employee_id,
         e.first_name_en AS first_name,
         e.last_name_en AS last_name,
         e.employment_status
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );

    const row = result.rows[0];
    const isActiveEmployee =
      !row?.employee_record_id || row.employment_status === "ACTIVE";
    if (!row || row.account_status !== "ACTIVE" || !isActiveEmployee) {
      req.session.destroy(() => undefined);
      res.clearCookie("ems.sid", {
        httpOnly: true,
        secure: env.SESSION_COOKIE_SECURE,
        sameSite: "lax",
        path: "/",
      });
      res.status(401).json({
        error: {
          code: "ACCOUNT_UNAVAILABLE",
          message: "This account is not available.",
        },
      });
      return;
    }

    const user: AuthenticatedUser = {
      userId: row.user_id,
      role: row.role,
      adminScope: row.admin_scope,
      isRoot: row.is_root,
      administeredDepartmentId: row.administered_department_id,
      employeeRecordId: row.employee_record_id,
      employeeId: row.employee_id,
      firstName: row.first_name,
      lastName: row.last_name,
      employmentStatus: row.employment_status,
      mustChangePassword: row.must_change_password,
    };
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePasswordChangeComplete(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.authUser?.mustChangePassword) {
    res.status(403).json({
      error: {
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Change your temporary password before continuing.",
      },
    });
    return;
  }
  next();
}

export function requireFirstLoginPasswordChange(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.authUser?.mustChangePassword) {
    res.status(409).json({
      error: {
        code: "PASSWORD_CHANGE_NOT_REQUIRED",
        message: "This account does not require a first-login password change.",
      },
    });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (req.authUser?.mustChangePassword) {
      res.status(403).json({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Change your temporary password before continuing.",
        },
      });
      return;
    }
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this action.",
        },
      });
      return;
    }
    try {
      if (req.authUser.role === "ADMIN") await authorizeAdminRequest(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireActiveEmployee(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.authUser?.mustChangePassword) {
    res.status(403).json({
      error: {
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Change your temporary password before continuing.",
      },
    });
    return;
  }
  if (
    !req.authUser?.employeeRecordId ||
    req.authUser.employmentStatus !== "ACTIVE"
  ) {
    res.status(403).json({
      error: {
        code: "ACTIVE_EMPLOYEE_REQUIRED",
        message: "An active employee account is required.",
      },
    });
    return;
  }
  next();
}

export function requireSelfOrAdmin(employeeIdParam = "employeeId") {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = req.authUser;
    const targetEmployeeId = req.params[employeeIdParam];
    if (user?.mustChangePassword) {
      res.status(403).json({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Change your temporary password before continuing.",
        },
      });
      return;
    }
    if (
      !user ||
      (user.employeeRecordId !== targetEmployeeId &&
        !(await canAccessEmployee(user, String(targetEmployeeId))))
    ) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You cannot access another employee's record.",
        },
      });
      return;
    }
    next();
  };
}

export function requireFullAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    !req.authUser ||
    !isFullAdmin(req.authUser) ||
    req.authUser.mustChangePassword
  ) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Full administrator access is required.",
      },
    });
    return;
  }
  next();
}

// Only the root administrator may grant, change or revoke administrator access.
// A full-access administrator granted by the root keeps every operational permission
// but is deliberately not enough here.
export function requireRootAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    !req.authUser ||
    !isRootAdmin(req.authUser) ||
    req.authUser.mustChangePassword
  ) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Only the root administrator can manage administrator access.",
      },
    });
    return;
  }
  next();
}
