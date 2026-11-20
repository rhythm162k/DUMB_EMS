import {
  departmentScope,
  employeeScopeSql,
  assertEmployeeAccess,
} from "../auth/scope.js";
import type { PoolClient } from "pg";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import {
  requirePasswordChangeComplete,
  requireActiveEmployee,
  requireAuth,
  requireRole,
  requireFullAdmin,
} from "../auth/middleware.js";
import { recordAudit } from "../audit/audit.js";
import { dayOffBalances } from "../leave/balance.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const uuid = z.string().uuid();
const date = z.iso.date();
const leaveInput = z.strictObject({
  employeeId: uuid,
  leaveTypeId: uuid,
  startDate: date,
  endDate: date,
  remarks: z.string().trim().max(2000).nullable().optional(),
});
const correction = leaveInput
  .omit({ employeeId: true })
  .extend({ reason: z.string().trim().min(1).max(1000) });
const cancelInput = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
});
const typeInput = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  nameEn: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120).nullable().optional(),
});
const holidayInput = z.strictObject({
  holidayDate: date,
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).nullable().optional(),
  sourceNote: z.string().trim().max(1000).nullable().optional(),
});
const bad = (message: string, code = "VALIDATION_ERROR") => ({
  error: { code, message },
});
const MS_DAY = 86400000;
function epoch(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}
function iso(value: Date | string) {
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}
async function calculate(client: PoolClient, start: string, end: string) {
  const a = epoch(start),
    b = epoch(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    return { error: "End date must be on or after start date." };
  if ((b - a) / MS_DAY > 3660)
    return { error: "Leave range must not exceed ten years." };
  const result = await client.query<{ holiday_date: string | Date }>(
    "SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date FROM public_holidays WHERE holiday_date BETWEEN $1 AND $2 ORDER BY holiday_date",
    [start, end],
  );
  const dates = [...new Set(result.rows.map((row) => iso(row.holiday_date)))];
  const holidays = new Set(dates);
  let days = 0;
  for (let day = a; day <= b; day += MS_DAY) {
    const weekday = new Date(day).getUTCDay();
    if (
      weekday !== 5 &&
      weekday !== 6 &&
      !holidays.has(new Date(day).toISOString().slice(0, 10))
    )
      days++;
  }
  if (days <= 0)
    return { error: "The selected period contains no chargeable leave days." };
  return { days, dates };
}
const recordSelect = `SELECT l.id, l.employee_id AS "employeeId", e.official_employee_id AS "employeeCode", CONCAT(e.first_name_en, ' ', e.last_name_en) AS "employeeName", l.leave_type_id AS "leaveTypeId", t.name_en AS "leaveType", to_char(l.start_date, 'YYYY-MM-DD') AS "startDate", to_char(l.end_date, 'YYYY-MM-DD') AS "endDate", l.day_count::float8 AS "dayCount", l.remarks, l.last_correction_reason AS "lastCorrectionReason", l.cancelled_at AS "cancelledAt", l.created_at AS "createdAt", l.updated_at AS "updatedAt" FROM leave_records l JOIN employees e ON e.id = l.employee_id JOIN leave_types t ON t.id = l.leave_type_id`;
async function audit(
  client: Parameters<typeof recordAudit>[0],
  user: NonNullable<Express.Request["authUser"]>,
  action: string,
  id: string,
  reason?: string,
) {
  await recordAudit(client, {
    actorUserId: user.userId,
    actorRole: user.role,
    action,
    entityType: "leave_record",
    entityId: id,
    ...(reason ? { reason } : {}),
  });
}
router.get(
  "/me/day-off-balance",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    try {
      const id = req.authUser?.employeeRecordId;
      if (!id) {
        res.status(403).json(bad("Employee profile required.", "FORBIDDEN"));
        return;
      }
      const result = await dayOffBalances(id, "", 1, 1);
      res.json({ balance: result.items[0] ?? null });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/admin/day-off-balances",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const query = z
        .object({
          q: z.string().trim().max(100).default(""),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(25),
        })
        .safeParse(req.query);
      if (!query.success) {
        res.status(400).json(bad("Invalid balance filters."));
        return;
      }
      res.json(
        await dayOffBalances(
          null,
          query.data.q,
          query.data.page,
          query.data.pageSize,
          departmentScope(req.authUser!),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/leave-types",
  requireAuth,
  requirePasswordChangeComplete,
  async (_req, res, next) => {
    try {
      const r = await pool.query(
        'SELECT id, code, name_en AS "nameEn", name_bn AS "nameBn", is_active AS "isActive" FROM leave_types ORDER BY name_en',
      );
      res.json({ items: r.rows });
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/holidays",
  requireAuth,
  requirePasswordChangeComplete,
  async (req, res, next) => {
    try {
      const year = z.coerce
        .number()
        .int()
        .min(2000)
        .max(2100)
        .safeParse(req.query.year);
      if (!year.success) {
        res.status(400).json(bad("A valid holiday year is required."));
        return;
      }
      const r = await pool.query(
        'SELECT id, to_char(holiday_date, \'YYYY-MM-DD\') AS "holidayDate", name_en AS "nameEn", name_bn AS "nameBn", source_note AS "sourceNote" FROM public_holidays WHERE holiday_date >= $1 AND holiday_date < $2 ORDER BY holiday_date',
        [`${year.data}-01-01`, `${year.data + 1}-01-01`],
      );
      res.json({ items: r.rows });
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/me/leaves",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    try {
      const id = req.authUser?.employeeRecordId;
      if (!id) {
        res.status(403).json(bad("Employee profile required.", "FORBIDDEN"));
        return;
      }
      const r = await pool.query(
        `${recordSelect} WHERE l.employee_id = $1 ORDER BY l.start_date DESC, l.created_at DESC`,
        [id],
      );
      res.json({ items: r.rows });
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/admin/leaves",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const id = req.query.employeeId;
      if (id !== undefined && !uuid.safeParse(id).success) {
        res.status(400).json(bad("Invalid employee ID."));
        return;
      }
      const r = await pool.query(
        `${recordSelect} WHERE ($1::uuid IS NULL OR l.employee_id=$1) AND ${employeeScopeSql("e", "$2")} ORDER BY l.start_date DESC, l.created_at DESC LIMIT 500`,
        [id ?? null, departmentScope(req.authUser!)],
      );
      res.json({ items: r.rows });
    } catch (e) {
      next(e);
    }
  },
);
router.post(
  "/admin/leave-types",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    const parsed = typeInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Invalid leave type."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "INSERT INTO leave_types (code, name_en, name_bn) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING RETURNING id",
        [parsed.data.code, parsed.data.nameEn, parsed.data.nameBn ?? null],
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(bad("Leave type code already exists.", "CONFLICT"));
        return;
      }
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "LEAVE_TYPE_CREATED",
        entityType: "leave_type",
        entityId: r.rows[0].id,
      });
      await client.query("COMMIT");
      res.status(201).json({ id: r.rows[0].id });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(e);
    } finally {
      client.release();
    }
  },
);
router.patch(
  "/admin/leave-types/:id",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    if (!uuid.safeParse(req.params.id).success) {
      res.status(400).json(bad("Invalid leave type ID."));
      return;
    }
    const parsed = z
      .strictObject({ isActive: z.boolean() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Invalid leave type status."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "UPDATE leave_types SET is_active=$1,updated_at=NOW() WHERE id=$2 RETURNING id",
        [parsed.data.isActive, req.params.id],
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Leave type not found.", "NOT_FOUND"));
        return;
      }
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "LEAVE_TYPE_UPDATED",
        entityType: "leave_type",
        entityId: r.rows[0].id,
      });
      await client.query("COMMIT");
      res.json({ id: r.rows[0].id });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(e);
    } finally {
      client.release();
    }
  },
);
router.post(
  "/admin/holidays",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    const parsed = holidayInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Invalid holiday."));
      return;
    }
    const d = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "INSERT INTO public_holidays (holiday_date,name_en,name_bn,source_note,year) VALUES ($1,$2,$3,$4,EXTRACT(YEAR FROM $1::date)::int) ON CONFLICT (holiday_date) DO NOTHING RETURNING id",
        [d.holidayDate, d.nameEn, d.nameBn ?? null, d.sourceNote ?? null],
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        res.status(409).json(bad("Holiday date already exists.", "CONFLICT"));
        return;
      }
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "HOLIDAY_CREATED",
        entityType: "holiday",
        entityId: r.rows[0].id,
      });
      await client.query("COMMIT");
      res.status(201).json({ id: r.rows[0].id });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(e);
    } finally {
      client.release();
    }
  },
);
router.delete(
  "/admin/holidays/:id",
  requireAuth,
  requireFullAdmin,
  async (req, res, next) => {
    if (!uuid.safeParse(req.params.id).success) {
      res.status(400).json(bad("Invalid holiday ID."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        "DELETE FROM public_holidays WHERE id=$1 RETURNING id",
        [req.params.id],
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Holiday not found.", "NOT_FOUND"));
        return;
      }
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "HOLIDAY_REMOVED",
        entityType: "holiday",
        entityId: r.rows[0].id,
      });
      await client.query("COMMIT");
      res.json({ deleted: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(e);
    } finally {
      client.release();
    }
  },
);
async function writeLeave(
  req: Request<{ id?: string }>,
  res: Response,
  next: NextFunction,
  isCorrection: boolean,
) {
  const parsed = (isCorrection ? correction : leaveInput).safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(bad("Invalid leave details or missing correction reason."));
    return;
  }
  const input = parsed.data;
  const id = isCorrection ? req.params.id : undefined;
  if (isCorrection && !uuid.safeParse(id).success) {
    res.status(400).json(bad("Invalid leave record ID."));
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let employeeId: string;
    if (isCorrection) {
      const owner = await client.query<{ employee_id: string }>(
        "SELECT employee_id FROM leave_records WHERE id=$1",
        [id],
      );
      if (owner.rows[0])
        await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
          owner.rows[0].employee_id,
        ]);
      const existing = await client.query<{
        employee_id: string;
        cancelled_at: Date | null;
      }>(
        "SELECT employee_id,cancelled_at FROM leave_records WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Leave record not found.", "NOT_FOUND"));
        return;
      }
      if (existing.rows[0]!.cancelled_at) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(bad("Cancelled leave cannot be corrected.", "CONFLICT"));
        return;
      }
      employeeId = existing.rows[0]!.employee_id;
    } else {
      employeeId = (input as z.infer<typeof leaveInput>).employeeId;
    }
    await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
      employeeId,
    ]);
    await assertEmployeeAccess(req.authUser!, employeeId, client);
    const employee = await client.query(
      "SELECT id FROM employees WHERE id=$1",
      [employeeId],
    );
    if (!employee.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json(bad("Employee not found.", "NOT_FOUND"));
      return;
    }
    const type = await client.query(
      "SELECT id FROM leave_types WHERE id=$1 AND is_active=TRUE",
      [input.leaveTypeId],
    );
    if (!type.rowCount) {
      await client.query("ROLLBACK");
      res.status(400).json(bad("Choose an active leave type."));
      return;
    }
    const count = await calculate(client, input.startDate, input.endDate);
    if ("error" in count) {
      await client.query("ROLLBACK");
      res.status(400).json(bad(count.error!));
      return;
    }
    const overlap = await client.query(
      "SELECT id FROM leave_records WHERE employee_id=$1 AND cancelled_at IS NULL AND start_date <= $3::date AND end_date >= $2::date AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1",
      [employeeId, input.startDate, input.endDate, id ?? null],
    );
    if (overlap.rowCount) {
      await client.query("ROLLBACK");
      res
        .status(409)
        .json(
          bad(
            "This employee has an overlapping leave record.",
            "LEAVE_OVERLAP",
          ),
        );
      return;
    }
    const result = isCorrection
      ? await client.query(
          "UPDATE leave_records SET leave_type_id=$2,start_date=$3,end_date=$4,day_count=$5,remarks=$6,last_correction_reason=$7,updated_at=NOW() WHERE id=$1 RETURNING id",
          [
            id,
            input.leaveTypeId,
            input.startDate,
            input.endDate,
            count.days,
            input.remarks ?? null,
            (input as z.infer<typeof correction>).reason,
          ],
        )
      : await client.query(
          "INSERT INTO leave_records (employee_id,leave_type_id,start_date,end_date,day_count,remarks,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            employeeId,
            input.leaveTypeId,
            input.startDate,
            input.endDate,
            count.days,
            input.remarks ?? null,
            req.authUser!.userId,
          ],
        );
    const leaveId = result.rows[0]!.id as string;
    await client.query(
      "INSERT INTO leave_holiday_snapshots (leave_record_id,holiday_date) SELECT $1,unnest($2::date[]) ON CONFLICT DO NOTHING",
      [leaveId, count.dates],
    );
    if (isCorrection)
      await client.query(
        "DELETE FROM leave_holiday_snapshots WHERE leave_record_id=$1 AND NOT (holiday_date=ANY($2::date[]))",
        [leaveId, count.dates],
      );
    await audit(
      client,
      req.authUser!,
      isCorrection ? "LEAVE_CORRECTED" : "LEAVE_CREATED",
      leaveId,
      isCorrection ? (input as z.infer<typeof correction>).reason : undefined,
    );
    await client.query("COMMIT");
    res.status(isCorrection ? 200 : 201).json({
      id: leaveId,
      dayCount: count.days,
      excludedHolidays: count.dates,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(e);
  } finally {
    client.release();
  }
}
router.post(
  "/admin/leaves",
  requireAuth,
  requireRole("ADMIN"),
  (req, res, next) => {
    void writeLeave(req, res, next, false);
  },
);
router.patch(
  "/admin/leaves/:id",
  requireAuth,
  requireRole("ADMIN"),
  (req, res, next) => {
    void writeLeave(req, res, next, true);
  },
);
router.post(
  "/admin/leaves/:id/cancel",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const parsed = cancelInput.safeParse(req.body);
    if (!uuid.safeParse(req.params.id).success || !parsed.success) {
      res
        .status(400)
        .json(bad("Valid leave ID and cancellation reason required."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query<{ employee_id: string }>(
        "SELECT employee_id FROM leave_records WHERE id=$1",
        [req.params.id],
      );
      if (!row.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Leave not found.", "NOT_FOUND"));
        return;
      }
      await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        row.rows[0]!.employee_id,
      ]);
      await assertEmployeeAccess(
        req.authUser!,
        row.rows[0]!.employee_id,
        client,
      );
      const updated = await client.query(
        "UPDATE leave_records SET cancelled_at=NOW(),last_correction_reason=$2,updated_at=NOW() WHERE id=$1 AND cancelled_at IS NULL RETURNING id",
        [req.params.id, parsed.data.reason],
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        res.status(409).json(bad("Leave already cancelled.", "CONFLICT"));
        return;
      }
      await audit(
        client,
        req.authUser!,
        "LEAVE_CANCELLED",
        String(req.params.id),
        parsed.data.reason,
      );
      await client.query("COMMIT");
      res.json({ cancelled: true });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(e);
    } finally {
      client.release();
    }
  },
);
export default router;
