import { randomUUID } from "node:crypto";
import { Router } from "express";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  DemoHttpError,
  requireDemoAdmin,
  requireDemoAuth,
  requireDemoCsrf,
  type DemoSession,
} from "./session.js";
import {
  adminTarget,
  assertion,
  audit,
  changedOne,
  checkAdminTarget,
  expectedVersion,
  fields,
  guardTarget,
  parse,
  patch,
  stamp,
  statement,
  uuid,
  write,
} from "./writes.js";

const day = z.iso.date();
const dates = z.strictObject({
  leaveTypeId: uuid,
  startDate: day,
  endDate: day,
  remarks: z.string().trim().max(2000).nullish(),
});
const newLeave = dates.extend({ employeeId: uuid });
const correction = dates.extend({ reason: z.string().trim().min(1).max(1000) });
const reasonSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
});
const decision = z.strictObject({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(1).max(1000).optional(),
});
const typeSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  nameEn: z.string().trim().min(1).max(120),
  nameBn: z.string().trim().max(120).nullish(),
});
const typeUpdate = typeSchema
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
const holidaySchema = z.strictObject({
  holidayDate: day,
  nameEn: z.string().trim().min(1).max(200),
  nameBn: z.string().trim().max(200).nullish(),
  sourceNote: z.string().trim().max(1000).nullish(),
});
const balanceQuery = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const duration = 86_400_000;
const epoch = (date: string) => Math.floor(Date.parse(date) / duration);
const weekday = (date: number) => (((date + 4) % 7) + 7) % 7;
function workingDays(start: number, end: number, holidays: number[]) {
  if (end < start) return 0;
  const span = end - start + 1;
  let result = Math.floor(span / 7) * 5;
  for (let i = 0; i < span % 7; i++)
    if (weekday(start + i) !== 5 && weekday(start + i) !== 6) result++;
  for (const h of holidays)
    if (h >= start && h <= end && weekday(h) !== 5 && weekday(h) !== 6)
      result--;
  return result;
}

async function calendar(session: DemoSession, input: z.infer<typeof dates>) {
  const start = epoch(input.startDate),
    end = epoch(input.endDate);
  if (end < start || end - start > 3660)
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  const [type, holidays] = await env.DB.batch<{ holiday_date: string }>([
    statement(
      "SELECT id FROM leave_types WHERE workspace_id=? AND id=? AND is_active=1",
      session.workspaceId,
      input.leaveTypeId,
    ),
    statement(
      "SELECT holiday_date FROM public_holidays WHERE workspace_id=? AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date",
      session.workspaceId,
      input.startDate,
      input.endDate,
    ),
  ]);
  if (!type?.results.length) throw new DemoHttpError(400, "VALIDATION_ERROR");
  const excluded = (holidays?.results ?? []).map((x) => x.holiday_date);
  const days = workingDays(start, end, excluded.map(epoch));
  if (days <= 0) throw new DemoHttpError(400, "VALIDATION_ERROR");
  const guards = [
    assertion(
      "EXISTS (SELECT 1 FROM leave_types WHERE workspace_id=? AND id=? AND is_active=1)",
      session.workspaceId,
      input.leaveTypeId,
    ),
    assertion(
      `(SELECT coalesce(json_group_array(holiday_date),'[]') FROM (
      SELECT holiday_date FROM public_holidays WHERE workspace_id=? AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date
    ))=?`,
      session.workspaceId,
      input.startDate,
      input.endDate,
      JSON.stringify(excluded),
    ),
  ];
  return { days, excluded, guards };
}
function insertLeave(
  session: DemoSession,
  id: string,
  employeeId: string,
  input: z.infer<typeof dates>,
  days: number,
) {
  return [
    assertion(
      "(SELECT count(*) FROM leave_records WHERE workspace_id=? AND employee_id=?) < 30",
      session.workspaceId,
      employeeId,
    ),
    statement(
      `INSERT INTO leave_records (workspace_id,id,employee_id,leave_type_id,start_date,end_date,day_count,remarks,recorded_by)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      session.workspaceId,
      id,
      employeeId,
      input.leaveTypeId,
      input.startDate,
      input.endDate,
      days,
      input.remarks ?? null,
      session.id,
    ),
  ];
}
const snapshot = (session: DemoSession, id: string, excluded: string[]) =>
  statement(
    `INSERT INTO leave_holiday_snapshots
  (workspace_id,leave_record_id,holiday_date) SELECT ?,?,value FROM json_each(?)`,
    session.workspaceId,
    id,
    JSON.stringify(excluded),
  );
type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  remarks: string | null;
  cancelled_at: string | null;
  version: number;
  status: string;
};
async function record(session: DemoSession, id: string) {
  const row = await statement(
    "SELECT * FROM leave_records WHERE workspace_id=? AND id=?",
    session.workspaceId,
    id,
  ).first<LeaveRow>();
  if (!row) throw new DemoHttpError(404, "NOT_FOUND");
  await adminTarget(session, row.employee_id);
  if (row.cancelled_at) throw new DemoHttpError(409, "CHANGE_CONFLICT");
  return row;
}
const router = Router();
const admin = [requireDemoAuth, requireDemoAdmin, requireDemoCsrf];
const full = (session: DemoSession) => {
  if (session.adminScope !== "FULL") throw new DemoHttpError(403, "FORBIDDEN");
};

router.post("/admin/leaves", ...admin, async (req, res) => {
  const session = req.demoSession!,
    input = parse(newLeave, req.body),
    id = randomUUID();
  await adminTarget(session, input.employeeId);
  const { days, excluded, guards } = await calendar(session, input);
  await write(session, [
    guardTarget(session, input.employeeId),
    ...guards,
    ...insertLeave(session, id, input.employeeId, input, days),
    snapshot(session, id, excluded),
    audit(session, "LEAVE_CREATED", "leave_record", id),
  ]);
  res.status(201).json({ id, dayCount: days, excludedHolidays: excluded });
});
router.patch("/admin/leaves/:id", ...admin, async (req, res) => {
  const session = req.demoSession!,
    input = parse(correction, req.body),
    id = parse(uuid, req.params.id);
  const row = await record(session, id);
  const version = expectedVersion(req, row.version);
  const { days, excluded, guards } = await calendar(session, input);
  await write(session, [
    guardTarget(session, row.employee_id),
    ...guards,
    statement(
      `UPDATE leave_records SET leave_type_id=?,start_date=?,end_date=?,day_count=?,remarks=?,
      last_correction_reason=?,updated_at=${stamp},version=version+1 WHERE workspace_id=? AND id=? AND version=? AND cancelled_at IS NULL`,
      input.leaveTypeId,
      input.startDate,
      input.endDate,
      days,
      input.remarks ?? null,
      input.reason,
      session.workspaceId,
      id,
      version,
    ),
    changedOne(),
    statement(
      "DELETE FROM leave_holiday_snapshots WHERE workspace_id=? AND leave_record_id=?",
      session.workspaceId,
      id,
    ),
    snapshot(session, id, excluded),
    audit(session, "LEAVE_CORRECTED", "leave_record", id, input.reason),
  ]);
  res.json({ id, dayCount: days, excludedHolidays: excluded });
});
router.post("/admin/leaves/:id/cancel", ...admin, async (req, res) => {
  const session = req.demoSession!,
    { reason } = parse(reasonSchema, req.body),
    id = parse(uuid, req.params.id);
  const row = await record(session, id);
  await write(session, [
    guardTarget(session, row.employee_id),
    statement(
      `UPDATE leave_records SET cancelled_at=${stamp},
    updated_at=${stamp},last_correction_reason=?,version=version+1 WHERE workspace_id=? AND id=? AND version=? AND cancelled_at IS NULL`,
      reason,
      session.workspaceId,
      id,
      expectedVersion(req, row.version),
    ),
    changedOne(),
    audit(session, "LEAVE_CANCELLED", "leave_record", id, reason),
  ]);
  res.json({ cancelled: true });
});

router.post("/admin/leave-types", ...admin, async (req, res) => {
  const session = req.demoSession!,
    input = parse(typeSchema, req.body),
    id = randomUUID();
  full(session);
  await write(session, [
    assertion(
      "(SELECT count(*) FROM leave_types WHERE workspace_id=?) < 24",
      session.workspaceId,
    ),
    statement(
      "INSERT INTO leave_types (workspace_id,id,code,name_en,name_bn) VALUES (?,?,?,?,?)",
      session.workspaceId,
      id,
      input.code,
      input.nameEn,
      input.nameBn || null,
    ),
    audit(session, "LEAVE_TYPE_CREATED", "leave_type", id),
  ]);
  res.status(201).json({ id });
});
router.patch("/admin/leave-types/:id", ...admin, async (req, res) => {
  const session = req.demoSession!,
    input = parse(typeUpdate, req.body),
    id = parse(uuid, req.params.id);
  full(session);
  const old = await statement(
    "SELECT version FROM leave_types WHERE workspace_id=? AND id=?",
    session.workspaceId,
    id,
  ).first<number>("version");
  if (!old) throw new DemoHttpError(404, "NOT_FOUND");
  const data = fields(
    {
      ...input,
      isActive:
        input.isActive === undefined ? undefined : Number(input.isActive),
    },
    [
      { key: "nameEn", column: "name_en" },
      { key: "nameBn", column: "name_bn" },
      { key: "isActive", column: "is_active" },
    ],
  );
  if (!data.length) throw new DemoHttpError(400, "VALIDATION_ERROR");
  await write(session, [
    patch(
      "leave_types",
      data,
      "workspace_id=? AND id=? AND version=?",
      session.workspaceId,
      id,
      expectedVersion(req, old),
    ),
    changedOne(),
    audit(session, "LEAVE_TYPE_UPDATED", "leave_type", id),
  ]);
  res.json({ id });
});
router.post("/admin/holidays", ...admin, async (req, res) => {
  const session = req.demoSession!,
    input = parse(holidaySchema, req.body),
    id = randomUUID();
  full(session);
  await write(session, [
    assertion(
      "(SELECT count(*) FROM public_holidays WHERE workspace_id=?) < 120",
      session.workspaceId,
    ),
    statement(
      "INSERT INTO public_holidays (workspace_id,id,holiday_date,name_en,name_bn,source_note,year) VALUES (?,?,?,?,?,?,?)",
      session.workspaceId,
      id,
      input.holidayDate,
      input.nameEn,
      input.nameBn || null,
      input.sourceNote || null,
      Number(input.holidayDate.slice(0, 4)),
    ),
    audit(session, "HOLIDAY_CREATED", "holiday", id),
  ]);
  res.status(201).json({ id });
});
router.delete("/admin/holidays/:id", ...admin, async (req, res) => {
  const session = req.demoSession!,
    id = parse(uuid, req.params.id);
  full(session);
  await write(session, [
    statement(
      "DELETE FROM public_holidays WHERE workspace_id=? AND id=?",
      session.workspaceId,
      id,
    ),
    changedOne(),
    audit(session, "HOLIDAY_DELETED", "holiday", id),
  ]);
  res.status(204).end();
});

function scopeSql(session: DemoSession) {
  return session.administeredDepartmentId
    ? ` AND e.department_id=? AND NOT EXISTS
    (SELECT 1 FROM users u WHERE u.workspace_id=e.workspace_id AND u.employee_id=e.id AND u.role='ADMIN')`
    : "";
}

router.get(
  ["/admin/leave-requests", "/me/leave-requests"],
  requireDemoAuth,
  async (req, res) => {
    const session = req.demoSession!,
      admin = req.path.toLowerCase().startsWith("/admin/");
    if (admin && session.role !== "ADMIN")
      throw new DemoHttpError(403, "FORBIDDEN");
    const scope = admin ? scopeSql(session) : " AND e.id=?";
    const id = admin
      ? session.administeredDepartmentId
      : session.employeeRecordId;
    const results = await statement(
      `SELECT r.id,e.official_employee_id AS employeeCode,
    e.first_name_en || ' ' || coalesce(e.last_name_en,'') AS employeeName,t.name_en AS leaveType,
    r.start_date AS startDate,r.end_date AS endDate,r.remarks,r.status,r.reason
    FROM leave_requests r JOIN employees e ON e.workspace_id=r.workspace_id AND e.id=r.employee_id
    JOIN leave_types t ON t.workspace_id=r.workspace_id AND t.id=r.leave_type_id
    WHERE r.workspace_id=?${scope} ORDER BY r.submitted_at DESC,r.id DESC LIMIT 100`,
      session.workspaceId,
      ...(id ? [id] : []),
    ).all();
    res.json({ items: results.results });
  },
);
router.post(
  "/me/leave-requests",
  requireDemoAuth,
  requireDemoCsrf,
  async (req, res) => {
    const session = req.demoSession!,
      input = parse(dates, req.body),
      id = randomUUID();
    const { guards } = await calendar(session, input);
    await write(session, [
      ...guards,
      assertion(
        "(SELECT count(*) FROM leave_requests WHERE workspace_id=? AND employee_id=?) < 30",
        session.workspaceId,
        session.employeeRecordId,
      ),
      assertion(
        `NOT EXISTS (SELECT 1 FROM leave_records WHERE workspace_id=? AND employee_id=?
      AND cancelled_at IS NULL AND start_date<=? AND end_date>=?)`,
        session.workspaceId,
        session.employeeRecordId,
        input.endDate,
        input.startDate,
      ),
      statement(
        `INSERT INTO leave_requests (workspace_id,id,employee_id,leave_type_id,start_date,end_date,remarks)
      VALUES (?,?,?,?,?,?,?)`,
        session.workspaceId,
        id,
        session.employeeRecordId,
        input.leaveTypeId,
        input.startDate,
        input.endDate,
        input.remarks ?? null,
      ),
      audit(session, "LEAVE_REQUEST_SUBMITTED", "leave_request", id),
    ]);
    res.status(201).json({ id, status: "PENDING" });
  },
);
router.post(
  "/me/leave-requests/:id/withdraw",
  requireDemoAuth,
  requireDemoCsrf,
  async (req, res) => {
    const session = req.demoSession!,
      id = parse(uuid, req.params.id);
    await write(session, [
      statement(
        "UPDATE leave_requests SET status='WITHDRAWN' WHERE workspace_id=? AND id=? AND employee_id=? AND status='PENDING'",
        session.workspaceId,
        id,
        session.employeeRecordId,
      ),
      changedOne(),
      audit(session, "LEAVE_REQUEST_WITHDRAWN", "leave_request", id),
    ]);
    res.json({ id, status: "WITHDRAWN" });
  },
);
router.post(
  "/admin/leave-requests/:id/decision",
  ...admin,
  async (req, res) => {
    const session = req.demoSession!,
      input = parse(decision, req.body),
      id = parse(uuid, req.params.id);
    const row = await statement(
      `SELECT r.employee_id,r.leave_type_id,r.start_date,r.end_date,r.remarks,r.status,
        e.department_id,u.role AS account_role,u.is_root
      FROM leave_requests r
      JOIN employees e ON e.workspace_id=r.workspace_id AND e.id=r.employee_id
      LEFT JOIN users u ON u.workspace_id=e.workspace_id AND u.employee_id=e.id
      WHERE r.workspace_id=? AND r.id=?`,
      session.workspaceId,
      id,
    ).first<
      Pick<
        LeaveRow,
        | "employee_id"
        | "leave_type_id"
        | "start_date"
        | "end_date"
        | "remarks"
        | "status"
      > & {
        department_id: string;
        account_role: string | null;
        is_root: number | null;
      }
    >();
    if (!row) throw new DemoHttpError(404, "NOT_FOUND");
    checkAdminTarget(session, row);
    if (row.status !== "PENDING")
      throw new DemoHttpError(409, "CHANGE_CONFLICT");
    if (input.action === "REJECT" && !input.reason)
      throw new DemoHttpError(400, "VALIDATION_ERROR");
    const approval = input.action === "APPROVE";
    const leaveId = approval ? randomUUID() : null;
    const status = approval ? "APPROVED" : "REJECTED";
    const changes: D1PreparedStatement[] = [];
    if (leaveId) {
      const dates = {
        leaveTypeId: row.leave_type_id,
        startDate: row.start_date,
        endDate: row.end_date,
        remarks: row.remarks,
      };
      const { days, excluded, guards } = await calendar(session, dates);
      changes.push(
        ...guards,
        ...insertLeave(session, leaveId, row.employee_id, dates, days),
        snapshot(session, leaveId, excluded),
      );
    }
    await write(session, [
      guardTarget(session, row.employee_id),
      ...changes,
      statement(
        `UPDATE leave_requests SET status=?,reviewed_by=?,
    reviewed_at=${stamp},reason=?,leave_record_id=? WHERE workspace_id=? AND id=? AND status='PENDING'`,
        status,
        session.id,
        input.reason ?? null,
        leaveId,
        session.workspaceId,
        id,
      ),
      changedOne(),
      audit(
        session,
        "LEAVE_REQUEST_" + status,
        "leave_request",
        id,
        input.reason,
      ),
    ]);
    res.json({ id, status, leaveRecordId: leaveId });
  },
);

router.get(
  ["/admin/day-off-balances", "/me/day-off-balance"],
  requireDemoAuth,
  async (req, res) => {
    const session = req.demoSession!,
      admin = req.path.toLowerCase().startsWith("/admin/");
    if (admin && session.role !== "ADMIN")
      throw new DemoHttpError(403, "FORBIDDEN");
    const { q, page, pageSize } = parse(
      balanceQuery,
      admin ? req.query : { pageSize: 1 },
    );
    const scope = admin ? scopeSql(session) : " AND e.id=?";
    const id = admin
      ? session.administeredDepartmentId
      : session.employeeRecordId;
    const cte = `WITH selected AS (
    SELECT e.id,e.official_employee_id,e.first_name_en,e.last_name_en,e.joining_date FROM employees e
    WHERE e.workspace_id=?${scope} AND instr(lower(e.official_employee_id || ' ' || e.first_name_en || ' ' ||
      coalesce(e.last_name_en,'') || ' ' || coalesce(e.full_name_bn,'')),lower(?))>0
    ORDER BY e.official_employee_id,e.id LIMIT ? OFFSET ?)`;
    const args = [
      session.workspaceId,
      ...(id ? [id] : []),
      q,
      pageSize + 1,
      (page - 1) * pageSize,
    ];
    type Row = {
      id: string;
      employeeCode: string;
      employeeName: string;
      joiningDate: string | null;
      asOf: string;
      employee_id: string;
      start_date: string;
      end_date: string;
      holiday_date: string;
    };
    const [people, leaves, calendar] = await env.DB.batch<Row>([
      statement(
        cte +
          ` SELECT id,official_employee_id AS employeeCode,trim(first_name_en || ' ' || coalesce(last_name_en,'')) AS employeeName,
      joining_date AS joiningDate,date('now','+6 hours') AS asOf FROM selected`,
        ...args,
      ),
      statement(
        cte +
          ` SELECT l.employee_id,l.start_date,l.end_date FROM leave_records l JOIN selected s ON s.id=l.employee_id
      WHERE l.workspace_id=? AND l.cancelled_at IS NULL`,
        ...args,
        session.workspaceId,
      ),
      statement(
        "SELECT holiday_date FROM public_holidays WHERE workspace_id=?",
        session.workspaceId,
      ),
    ]);
    const holidays = (calendar?.results ?? []).map((x) =>
      epoch(x.holiday_date),
    );
    const byEmployee = new Map<string, Row[]>();
    for (const leave of leaves?.results ?? []) {
      const entries = byEmployee.get(leave.employee_id);
      if (entries) entries.push(leave);
      else byEmployee.set(leave.employee_id, [leave]);
    }
    const items = (people?.results ?? [])
      .slice(0, pageSize)
      .map(({ id, employeeCode, employeeName, joiningDate, asOf }) => {
        const base = {
          employeeId: id,
          employeeCode,
          employeeName,
          joiningDate,
          asOf,
        };
        if (!joiningDate)
          return {
            ...base,
            workedDays: null,
            earnedDays: null,
            takenDays: null,
            balanceDays: null,
            advanceDays: null,
            progressDays: null,
            workdaysUntilNext: null,
            scheduledDays: 0,
          };
        const start = epoch(joiningDate),
          today = epoch(asOf);
        let takenDays = 0,
          scheduledDays = 0;
        for (const leave of byEmployee.get(id) ?? []) {
          const from = Math.max(start, epoch(leave.start_date)),
            to = epoch(leave.end_date);
          takenDays += workingDays(from, Math.min(today, to), holidays);
          scheduledDays += workingDays(Math.max(from, today + 1), to, holidays);
        }
        const workedDays = workingDays(start, today, holidays) - takenDays;
        const earnedDays = Math.floor(workedDays / 11),
          balanceDays = earnedDays - takenDays,
          progressDays = workedDays % 11;
        return {
          ...base,
          workedDays,
          takenDays,
          earnedDays,
          balanceDays,
          progressDays,
          workdaysUntilNext: 11 - progressDays,
          advanceDays: Math.max(0, -balanceDays),
          scheduledDays,
        };
      });
    res.json(
      admin
        ? {
            items,
            pagination: {
              page,
              pageSize,
              hasMore: (people?.results.length ?? 0) > pageSize,
            },
          }
        : { balance: items[0] ?? null },
    );
  },
);
export default router;
