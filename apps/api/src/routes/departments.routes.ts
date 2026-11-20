import { departmentScope } from "../auth/scope.js";
import { Router } from "express";
import {
  requireAuth,
  requirePasswordChangeComplete,
} from "../auth/middleware.js";
import { pool } from "../config/database.js";

const router = Router();

// Active departments for dropdowns. Admin management (create/rename/deactivate) comes later in Phase 3.
router.get(
  "/",
  requireAuth,
  requirePasswordChangeComplete,
  async (req, res, next) => {
    try {
      const result = await pool.query<{
        id: string;
        name_en: string;
        name_bn: string | null;
      }>(
        "SELECT id, name_en, name_bn FROM departments WHERE is_active = TRUE AND ($1::uuid IS NULL OR id=$1) ORDER BY name_en ASC",
        [
          req.authUser!.role === "ADMIN"
            ? departmentScope(req.authUser!)
            : null,
        ],
      );
      res.status(200).json({
        departments: result.rows.map((row) => ({
          id: row.id,
          nameEn: row.name_en,
          nameBn: row.name_bn,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
