import { Router } from "express";
import {
  requirePasswordChangeComplete,
  requireAuth,
} from "../auth/middleware.js";
import { getEmployeeDetail } from "../employees/repository.js";
import { toEmployeeProfile } from "../employees/serializers.js";
import { listAllRecords } from "../records/repository.js";
import { getSpouse } from "../spouse/repository.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// The employee is resolved from the authenticated session only. No ID is
// accepted from the client, so one employee cannot request another's record.
router.get(
  "/profile",
  requireAuth,
  requirePasswordChangeComplete,
  async (req, res, next) => {
    try {
      const employeeRecordId = req.authUser?.employeeRecordId;
      if (!employeeRecordId) {
        res.status(404).json({
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "No employee profile is linked to this account.",
          },
        });
        return;
      }

      const employee = await getEmployeeDetail(employeeRecordId);
      if (!employee) {
        res.status(404).json({
          error: {
            code: "PROFILE_NOT_FOUND",
            message: "No employee profile is linked to this account.",
          },
        });
        return;
      }
      // The employee's own PDS sections, read-only. Resolved from the same session-derived ID.
      res.status(200).json({
        profile: toEmployeeProfile(employee),
        records: await listAllRecords(employee.id),
        spouse: await getSpouse(employee.id),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
