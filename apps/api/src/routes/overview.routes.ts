import { departmentScope, employeeScopeSql } from "../auth/scope.js";
import { Router } from "express";
import { pool } from "../config/database.js";
import {
  requirePasswordChangeComplete,
  requireAuth,
} from "../auth/middleware.js";

const router = Router();
router.get(
  "/overview/stats",
  requireAuth,
  requirePasswordChangeComplete,
  async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (req.authUser?.role === "ADMIN") {
        const result = await pool.query<{
          employees: number;
          departments: number;
          department_name: string | null;
          requests: number;
          requesters: number;
          on_leave: number;
          active: number;
        }>(
          `WITH scoped_employees AS (SELECT e.* FROM employees e WHERE ${employeeScopeSql("e", "$1")}),
        scoped_requests AS (SELECT cr.* FROM change_requests cr JOIN scoped_employees e ON e.id=cr.employee_id)
        SELECT
        (SELECT COUNT(*)::int FROM scoped_employees) AS employees,
        (SELECT COUNT(*)::int FROM departments WHERE is_active = TRUE AND ($1::uuid IS NULL OR id=$1)) AS departments,
        (SELECT name_en FROM departments WHERE id=$1::uuid) AS department_name,
        (SELECT COUNT(*)::int FROM scoped_requests WHERE status = 'PENDING') AS requests,
        (SELECT COUNT(DISTINCT employee_id)::int FROM scoped_requests WHERE status = 'PENDING') AS requesters,
        (SELECT COUNT(*)::int FROM scoped_employees e WHERE e.employment_status = 'ACTIVE' AND EXISTS (
          SELECT 1 FROM leave_records l WHERE l.employee_id = e.id AND l.cancelled_at IS NULL
          AND CURRENT_DATE BETWEEN l.start_date AND l.end_date
        )) AS on_leave,
        (SELECT COUNT(*)::int FROM scoped_employees WHERE employment_status = 'ACTIVE') AS active`,
          [departmentScope(req.authUser)],
        );
        const row = result.rows[0]!;
        res.json({
          employees: row.employees,
          departments: row.departments,
          departmentName: row.department_name,
          requests: row.requests,
          requesters: row.requesters,
          onLeave: row.on_leave,
          active: row.active,
          available: row.active - row.on_leave,
        });
        return;
      }
      const employeeId = req.authUser?.employeeRecordId;
      if (!employeeId) {
        res.status(403).json({
          error: { code: "FORBIDDEN", message: "Employee profile required." },
        });
        return;
      }
      const result = await pool.query<{
        requests: number;
        leaves: number;
        on_leave: boolean;
      }>(
        `SELECT
      (SELECT COUNT(*)::int FROM change_requests WHERE employee_id = $1 AND status = 'PENDING') AS requests,
      (SELECT COUNT(*)::int FROM leave_records WHERE employee_id = $1 AND cancelled_at IS NULL) AS leaves,
      EXISTS (SELECT 1 FROM leave_records WHERE employee_id = $1 AND cancelled_at IS NULL
        AND CURRENT_DATE BETWEEN start_date AND end_date) AS on_leave`,
        [employeeId],
      );
      const row = result.rows[0]!;
      res.json({
        requests: row.requests,
        leaves: row.leaves,
        onLeave: row.on_leave,
      });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
