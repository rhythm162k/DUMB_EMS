import { env } from "cloudflare:workers";
import { Router } from "express";
import { z } from "zod";
import {
  DemoHttpError,
  requireDemoAuth,
  requireDemoCsrf,
  requireDemoRoot,
} from "./session.js";
import { nowSeconds } from "./workspaces.js";

const router = Router();
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2_147_483_646);
const access = z.discriminatedUnion("accessLevel", [
  z.strictObject({ accessLevel: z.literal("FULL"), version }),
  z.strictObject({
    accessLevel: z.literal("DEPARTMENT"),
    departmentId: uuid,
    version,
  }),
  z.strictObject({ accessLevel: z.literal("NONE"), version }),
]);

router.put(
  "/admin/employees/:employeeId/admin-access",
  requireDemoAuth,
  requireDemoRoot,
  requireDemoCsrf,
  async (req, res) => {
    const input = access.safeParse(req.body);
    const employeeId = uuid.safeParse(req.params.employeeId);
    if (!input.success || !employeeId.success)
      throw new DemoHttpError(400, "VALIDATION_ERROR");

    const db = env.DB;
    const session = req.demoSession!;
    const scope =
      input.data.accessLevel === "NONE" ? null : input.data.accessLevel;
    const department =
      input.data.accessLevel === "DEPARTMENT" ? input.data.departmentId : null;
    // Scope, actor, expiry, target eligibility and optimistic version are checked in the write.
    // A zero-row update cannot fire the audit/invalidation trigger.
    const updated = await db
      .prepare(
        `UPDATE users AS target SET
        role=CASE WHEN ?1 IS NULL THEN 'EMPLOYEE' ELSE 'ADMIN' END, admin_scope=?1,
        administered_department_id=?2, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE workspace_id=?3 AND employee_id=?4 AND version=?5 AND entry_persona IS NULL AND is_root=0
      AND (?2 IS NULL OR EXISTS (SELECT 1 FROM departments WHERE workspace_id=?3 AND id=?2))
      AND (?1 IS NULL OR (account_status='ACTIVE' AND EXISTS (
        SELECT 1 FROM employees WHERE workspace_id=?3 AND id=?4 AND employment_status='ACTIVE'
      )))
      AND EXISTS (
        SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
        JOIN users actor ON actor.workspace_id=s.workspace_id AND actor.id=s.user_id
        JOIN employees owner ON owner.workspace_id=actor.workspace_id AND owner.id=actor.employee_id
        WHERE s.workspace_id=?3 AND s.token_hash=?6 AND actor.id=?7 AND w.expires_at>?8
          AND actor.is_root=1 AND actor.account_status='ACTIVE' AND owner.employment_status='ACTIVE'
      )
      RETURNING role, admin_scope AS adminScope, administered_department_id AS administeredDepartmentId, version`,
      )
      .bind(
        scope,
        department,
        session.workspaceId,
        employeeId.data,
        input.data.version,
        session.tokenHash,
        session.id,
        nowSeconds(),
      )
      .first();
    if (updated) {
      res.json({ account: updated });
      return;
    }

    const target = await db
      .prepare(
        `SELECT u.is_root AS isRoot,u.entry_persona AS persona,
      EXISTS (SELECT 1 FROM departments WHERE workspace_id=?1 AND id=?3) AS validDepartment
      FROM users u WHERE u.workspace_id=?1 AND u.employee_id=?2`,
      )
      .bind(session.workspaceId, employeeId.data, department)
      .first<{
        isRoot: number;
        persona: string | null;
        validDepartment: number;
      }>();
    if (!target) throw new DemoHttpError(404, "NOT_FOUND");
    if (target.isRoot) throw new DemoHttpError(409, "ROOT_ADMIN_PROTECTED");
    if (target.persona) throw new DemoHttpError(409, "ENTRY_PERSONA_PROTECTED");
    if (department && !target.validDepartment)
      throw new DemoHttpError(400, "DEPARTMENT_INVALID");
    throw new DemoHttpError(409, "WORKSPACE_CONFLICT");
  },
);

export default router;
