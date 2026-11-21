import { env } from "cloudflare:workers";
import { Router } from "express";
import { z } from "zod";
import { employeeListQuerySchema } from "../src/employees/schemas.js";
import {
  toAdminEmployeeDetail,
  toEmployeeListItem,
  toEmployeeProfile,
} from "../src/employees/serializers.js";
import { RECORD_SECTIONS } from "../src/records/sections.js";
import { DemoHttpError, requireDemoAdmin, requireDemoAuth } from "./session.js";
import type { DemoSession } from "./session.js";

const router = Router();
const uuid = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).max(1000).default(1);
const changeStatusSchema = z
  .enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "ALL"])
  .default("PENDING");
const yearSchema = z.coerce.number().int().min(2000).max(2100);

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DemoHttpError(400, "VALIDATION_ERROR");
  return parsed.data;
}

// Callers include a workspace predicate and use e as the employee alias.
// The additional predicates match the existing department-admin exclusions.
function employeeScope(session: DemoSession, departmentParameter = "?") {
  const department = session.administeredDepartmentId;
  return department
    ? {
        sql: ` AND e.department_id=${departmentParameter} AND NOT EXISTS (SELECT 1 FROM users scope_user
      WHERE scope_user.workspace_id=e.workspace_id AND scope_user.employee_id=e.id
      AND scope_user.role='ADMIN')`,
        params: [department],
      }
    : { sql: "", params: [] };
}

const employeeJoin = `
  LEFT JOIN departments d ON d.workspace_id=e.workspace_id AND d.id=e.department_id
  LEFT JOIN users u ON u.workspace_id=e.workspace_id AND u.employee_id=e.id`;

router.get(
  "/admin/employees",
  requireDemoAuth,
  requireDemoAdmin,
  async (req, res) => {
    const session = req.demoSession!;
    const filters = validate(employeeListQuerySchema, req.query);
    if (
      filters.departmentId &&
      session.administeredDepartmentId &&
      filters.departmentId !== session.administeredDepartmentId
    ) {
      throw new DemoHttpError(403, "FORBIDDEN");
    }
    const scope = employeeScope(session);
    const params = [session.workspaceId, ...scope.params];
    let where = " WHERE e.workspace_id=?" + scope.sql;
    if (filters.departmentId && !session.administeredDepartmentId) {
      where += " AND e.department_id=?";
      params.push(filters.departmentId);
    }
    if (filters.employmentStatus) {
      where += " AND e.employment_status=?";
      params.push(filters.employmentStatus);
    }
    if (filters.q) {
      // Literal substring search, including Bangla, without SQLite's LIKE pattern limit.
      where += ` AND instr(lower(e.official_employee_id || ' ' || e.first_name_en || ' ' ||
      coalesce(e.last_name_en,'') || ' ' || coalesce(e.full_name_bn,'')), lower(?))>0`;
      params.push(filters.q);
    }
    const db = env.DB;
    const [count, page] = await db.batch([
      db
        .prepare(`SELECT COUNT(*) AS total FROM employees e${where}`)
        .bind(...params),
      db
        .prepare(
          `SELECT e.id, e.official_employee_id, e.first_name_en,e.last_name_en,e.full_name_bn,
        e.designation,e.employment_status,d.id AS department_id,d.name_en AS department_name_en,
        d.name_bn AS department_name_bn,u.role AS account_role,u.admin_scope,
        u.administered_department_id,u.account_status
      FROM employees e ${employeeJoin} ${where}
      ORDER BY e.first_name_en, e.last_name_en NULLS LAST, e.official_employee_id LIMIT ? OFFSET ?`,
        )
        .bind(
          ...params,
          filters.pageSize,
          (filters.page - 1) * filters.pageSize,
        ),
    ]);
    const total = Number(
      (count?.results[0] as { total: number } | undefined)?.total ?? 0,
    );
    res.json({
      items: (page?.results as Parameters<typeof toEmployeeListItem>[0][]).map(
        toEmployeeListItem,
      ),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      },
    });
  },
);

type ProfileRow = Omit<
  Parameters<typeof toAdminEmployeeDetail>[0],
  "account_is_root"
> & {
  account_is_root: number | null;
  account_version: number | null;
  version: number;
  entry_persona: string | null;
};

async function profile(
  session: DemoSession,
  employeeId: string,
  admin: boolean,
) {
  const scope = admin ? employeeScope(session) : { sql: "", params: [] };
  const db = env.DB;
  const row = await db
    .prepare(
      `SELECT e.*, d.name_en AS department_name_en, d.name_bn AS department_name_bn,
      u.role AS account_role, u.admin_scope, u.administered_department_id,
      u.is_root AS account_is_root, u.account_status, u.last_login_at,
      u.version AS account_version,u.entry_persona,0 AS must_change_password
    FROM employees e ${employeeJoin} WHERE e.workspace_id=? AND e.id=?${scope.sql}`,
    )
    .bind(session.workspaceId, employeeId, ...scope.params)
    .first<ProfileRow>();
  if (!row) {
    if (admin && session.administeredDepartmentId)
      throw new DemoHttpError(403, "FORBIDDEN");
    throw new DemoHttpError(404, "EMPLOYEE_NOT_FOUND");
  }
  const sectionResults = await db.batch([
    ...RECORD_SECTIONS.map((section) =>
      db
        .prepare(
          `SELECT id, ${section.fields.map((field) => `${field.column} AS "${field.key}"`).join(", ")},
        version, created_at AS createdAt, updated_at AS updatedAt
      FROM ${section.table} WHERE workspace_id=? AND employee_id=? ORDER BY ${section.orderBy} LIMIT 50`,
        )
        .bind(session.workspaceId, employeeId),
    ),
    db
      .prepare(
        `SELECT id, spouse_name AS spouseName, spouse_occupation AS spouseOccupation,
      spouse_date_of_birth AS spouseDateOfBirth, spouse_national_id AS spouseNationalId,
      version, created_at AS createdAt, updated_at AS updatedAt
      FROM employee_spouse WHERE workspace_id=? AND employee_id=?`,
      )
      .bind(session.workspaceId, employeeId),
  ]);
  return {
    row: {
      ...row,
      account_is_root: row.account_is_root === 1,
      must_change_password: false,
    },
    records: Object.fromEntries(
      RECORD_SECTIONS.map((section, index) => [
        section.responseKey,
        sectionResults[index]?.results ?? [],
      ]),
    ),
    spouse: sectionResults.at(-1)?.results[0] ?? null,
  };
}

router.get("/me/profile", requireDemoAuth, async (req, res) => {
  const session = req.demoSession!;
  const data = await profile(session, session.employeeRecordId, false);
  res.json({
    profile: toEmployeeProfile(data.row),
    records: data.records,
    spouse: data.spouse,
  });
});

router.get(
  "/admin/employees/:employeeId",
  requireDemoAuth,
  requireDemoAdmin,
  async (req, res) => {
    const id = validate(uuid, req.params.employeeId);
    const data = await profile(req.demoSession!, id, true);
    const employee = toAdminEmployeeDetail(data.row);
    res.json({
      employee: {
        ...employee,
        version: data.row.version,
        account: employee.account && {
          ...employee.account,
          version: data.row.account_version,
          entryPersona: data.row.entry_persona !== null,
        },
      },
      records: data.records,
      spouse: data.spouse,
    });
  },
);

router.get("/departments", requireDemoAuth, async (req, res) => {
  const session = req.demoSession!;
  const department = session.administeredDepartmentId;
  const result = await env.DB.prepare(
    `SELECT id,name_en AS nameEn,name_bn AS nameBn
    FROM departments WHERE workspace_id=? AND is_active=1${department ? " AND id=?" : ""}
    ORDER BY name_en`,
  )
    .bind(session.workspaceId, ...(department ? [department] : []))
    .all();
  res.json({ departments: result.results });
});

router.get(
  "/admin/departments",
  requireDemoAuth,
  requireDemoAdmin,
  async (req, res) => {
    const session = req.demoSession!;
    if (session.adminScope !== "FULL")
      throw new DemoHttpError(403, "FORBIDDEN");
    const result = await env.DB.prepare(
      `SELECT d.id,d.name_en AS nameEn,d.name_bn AS nameBn,
    d.is_active AS isActive,d.version,d.created_at AS createdAt,d.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM employees e WHERE e.workspace_id=d.workspace_id AND e.department_id=d.id) AS employeeCount
    FROM departments d WHERE d.workspace_id=? ORDER BY d.name_en`,
    )
      .bind(session.workspaceId)
      .all<{ isActive: number }>();
    res.json({
      departments: result.results.map((row) => ({
        ...row,
        isActive: row.isActive === 1,
      })),
    });
  },
);

router.get("/overview/stats", requireDemoAuth, async (req, res) => {
  const session = req.demoSession!;
  const today = "date('now','+6 hours')";
  if (session.role === "EMPLOYEE") {
    const row = await env.DB.prepare(
      `SELECT
      (SELECT COUNT(*) FROM change_requests WHERE workspace_id=?1 AND employee_id=?2 AND status='PENDING') AS requests,
      (SELECT COUNT(*) FROM leave_records WHERE workspace_id=?1 AND employee_id=?2 AND cancelled_at IS NULL) AS leaves,
      EXISTS (SELECT 1 FROM leave_records WHERE workspace_id=?1 AND employee_id=?2 AND cancelled_at IS NULL
        AND ${today} BETWEEN start_date AND end_date) AS onLeave`,
    )
      .bind(session.workspaceId, session.employeeRecordId)
      .first<{ requests: number; leaves: number; onLeave: number }>();
    res.json({ ...row, onLeave: row?.onLeave === 1 });
    return;
  }
  const scope = employeeScope(session, "?2");
  const row = await env.DB.prepare(
    `WITH scoped_employees AS (
      SELECT e.id,e.employment_status FROM employees e WHERE e.workspace_id=?1${scope.sql}
    ), scoped_requests AS (
      SELECT cr.employee_id FROM change_requests cr JOIN scoped_employees e ON e.id=cr.employee_id
      WHERE cr.workspace_id=?1 AND cr.status='PENDING'
    ) SELECT (SELECT COUNT(*) FROM scoped_employees) AS employees,
      (SELECT COUNT(*) FROM departments WHERE workspace_id=?1 AND is_active=1 AND (?2 IS NULL OR id=?2)) AS departments,
      (SELECT name_en FROM departments WHERE workspace_id=?1 AND id=?2) AS departmentName,
      (SELECT COUNT(*) FROM scoped_requests) AS requests,
      (SELECT COUNT(DISTINCT employee_id) FROM scoped_requests) AS requesters,
      (SELECT COUNT(*) FROM scoped_employees e WHERE e.employment_status='ACTIVE' AND EXISTS (
        SELECT 1 FROM leave_records l WHERE l.workspace_id=?1 AND l.employee_id=e.id
        AND l.cancelled_at IS NULL AND ${today} BETWEEN l.start_date AND l.end_date
      )) AS onLeave,
      (SELECT COUNT(*) FROM scoped_employees WHERE employment_status='ACTIVE') AS active`,
  )
    .bind(session.workspaceId, session.administeredDepartmentId)
    .first<{ active: number; onLeave: number }>();
  res.json({ ...row, available: (row?.active ?? 0) - (row?.onLeave ?? 0) });
});

function listChanges(admin: boolean) {
  return async (
    req: import("express").Request,
    res: import("express").Response,
  ) => {
    const session = req.demoSession!;
    const page = validate(pageSchema, req.query.page);
    const status = admin
      ? validate(changeStatusSchema, req.query.status)
      : "ALL";
    const scope = admin
      ? employeeScope(session)
      : { sql: " AND e.id=?", params: [session.employeeRecordId] };
    type ChangeRow = { oldValueSnapshot: string | null; proposedValue: string };
    const rows = await env.DB.prepare(
      `SELECT cr.id, cr.field_key AS fieldKey, cr.target_record_type AS targetRecordType,
      cr.target_record_id AS targetRecordId, cr.operation, cr.old_value_snapshot AS oldValueSnapshot,
      cr.proposed_value AS proposedValue, cr.status, cr.rejection_reason AS rejectionReason,cr.version,
      cr.submitted_at AS submittedAt, cr.reviewed_at AS reviewedAt, cr.withdrawn_at AS withdrawnAt
      ${
        admin
          ? `, e.id AS employeeId, e.official_employee_id AS officialEmployeeId, e.first_name_en AS employeeName,
        trim(re.first_name_en || ' ' || coalesce(re.last_name_en,'')) AS reviewedByName,
        re.official_employee_id AS reviewedByOfficialId`
          : ""
      }
      FROM change_requests cr JOIN employees e ON e.workspace_id=cr.workspace_id AND e.id=cr.employee_id
      ${
        admin
          ? `LEFT JOIN users ru ON ru.workspace_id=cr.workspace_id AND ru.id=cr.reviewed_by_user_id
        LEFT JOIN employees re ON re.workspace_id=ru.workspace_id AND re.id=ru.employee_id`
          : ""
      }
      WHERE cr.workspace_id=? ${scope.sql} ${status === "ALL" ? "" : " AND cr.status=?"}
      ORDER BY cr.submitted_at DESC,cr.id DESC LIMIT 50 OFFSET ?`,
    )
      .bind(
        session.workspaceId,
        ...scope.params,
        ...(status === "ALL" ? [] : [status]),
        (page - 1) * 50,
      )
      .all<ChangeRow>();
    res.json({
      page,
      items: rows.results.map((row) => ({
        ...row,
        oldValueSnapshot:
          row.oldValueSnapshot === null
            ? null
            : JSON.parse(row.oldValueSnapshot),
        proposedValue: JSON.parse(row.proposedValue),
      })),
    });
  };
}

router.get("/me/change-requests", requireDemoAuth, listChanges(false));
router.get(
  "/admin/change-requests",
  requireDemoAuth,
  requireDemoAdmin,
  listChanges(true),
);

function listLeaves(admin: boolean) {
  return async (
    req: import("express").Request,
    res: import("express").Response,
  ) => {
    const session = req.demoSession!;
    const employeeId = admin
      ? validate(uuid.optional(), req.query.employeeId)
      : session.employeeRecordId;
    const scope = admin ? employeeScope(session) : { sql: "", params: [] };
    const result = await env.DB.prepare(
      `SELECT l.id,l.employee_id AS employeeId,e.official_employee_id AS employeeCode,
      trim(e.first_name_en || ' ' || coalesce(e.last_name_en,'')) AS employeeName,l.leave_type_id AS leaveTypeId,
      t.name_en AS leaveType,l.start_date AS startDate,l.end_date AS endDate,l.day_count AS dayCount,
      l.remarks,l.last_correction_reason AS lastCorrectionReason,l.cancelled_at AS cancelledAt,
      l.created_at AS createdAt,l.updated_at AS updatedAt,l.version
      FROM leave_records l JOIN employees e ON e.workspace_id=l.workspace_id AND e.id=l.employee_id
      JOIN leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id
      WHERE l.workspace_id=?${scope.sql}${employeeId ? " AND l.employee_id=?" : ""}
      ORDER BY l.start_date DESC,l.id DESC LIMIT 100`,
    )
      .bind(
        session.workspaceId,
        ...scope.params,
        ...(employeeId ? [employeeId] : []),
      )
      .all();
    res.json({ items: result.results });
  };
}

router.get("/me/leaves", requireDemoAuth, listLeaves(false));
router.get(
  "/admin/leaves",
  requireDemoAuth,
  requireDemoAdmin,
  listLeaves(true),
);
router.get("/leave-types", requireDemoAuth, async (req, res) => {
  const result = await env.DB.prepare(
    `SELECT id,code,name_en AS nameEn,name_bn AS nameBn,is_active AS isActive,version
    FROM leave_types WHERE workspace_id=? ORDER BY name_en`,
  )
    .bind(req.demoSession!.workspaceId)
    .all<{ isActive: number }>();
  res.json({
    items: result.results.map((row) => ({
      ...row,
      isActive: row.isActive === 1,
    })),
  });
});
router.get("/holidays", requireDemoAuth, async (req, res) => {
  const year = validate(yearSchema, req.query.year);
  const result = await env.DB.prepare(
    `SELECT id,holiday_date AS holidayDate,name_en AS nameEn,name_bn AS nameBn,
    source_note AS sourceNote FROM public_holidays WHERE workspace_id=? AND holiday_date>=? AND holiday_date<?
    ORDER BY holiday_date`,
  )
    .bind(req.demoSession!.workspaceId, `${year}-01-01`, `${year + 1}-01-01`)
    .all();
  res.json({ items: result.results });
});

export default router;
