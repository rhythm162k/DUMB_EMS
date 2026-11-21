import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from "../src/departments/schemas.js";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  updateStatusSchema,
} from "../src/employees/schemas.js";
import { EMPLOYEE_UPDATE_FIELDS } from "../src/employees/updates.js";
import {
  DemoHttpError,
  requireDemoAdmin,
  requireDemoAuth,
  requireDemoCsrf,
  type DemoSession,
} from "./session.js";
import {
  activeDepartment,
  adminTarget,
  assertion,
  audit,
  changedOne,
  expectedVersion,
  fields,
  guardDepartment,
  guardTarget,
  parse,
  patch,
  statement,
  uuid,
  write,
} from "./writes.js";

const router = Router();
const admin = [requireDemoAuth, requireDemoAdmin, requireDemoCsrf];

export function createEmployeeStatements(
  session: DemoSession,
  id: string,
  data: ReturnType<typeof createEmployeeSchema.parse>,
) {
  const values = fields(data, EMPLOYEE_UPDATE_FIELDS);
  return [
    guardDepartment(session, data.departmentId),
    assertion(
      "(SELECT count(*) FROM employees WHERE workspace_id=?) < 60",
      session.workspaceId,
    ),
    statement(
      `INSERT INTO employees (workspace_id,id,official_employee_id,created_by,updated_by,${values.map((v) => v.column).join(",")})
      VALUES (?,?,?,?,?,${values.map(() => "?").join(",")})`,
      session.workspaceId,
      id,
      data.officialEmployeeId,
      session.id,
      session.id,
      ...values.map((v) => v.value),
    ),
    statement(
      "INSERT INTO users (workspace_id,id,employee_id,role) VALUES (?,?,?,'EMPLOYEE')",
      session.workspaceId,
      randomUUID(),
      id,
    ),
  ];
}

router.post("/admin/employees", ...admin, async (req, res) => {
  const session = req.demoSession!;
  const data = parse(createEmployeeSchema, req.body);
  await activeDepartment(session, data.departmentId);
  const id = randomUUID();
  await write(session, [
    ...createEmployeeStatements(session, id, data),
    audit(session, "EMPLOYEE_CREATED", "employee", id),
  ]);
  res
    .status(201)
    .json({ employee: { id, officialEmployeeId: data.officialEmployeeId } });
});

router.patch("/admin/employees/:employeeId", ...admin, async (req, res) => {
  const session = req.demoSession!;
  const id = parse(uuid, req.params.employeeId);
  if (req.body && Object.hasOwn(req.body, "officialEmployeeId"))
    throw new DemoHttpError(400, "EMPLOYEE_ID_IMMUTABLE");
  const input = parse(updateEmployeeSchema, req.body);
  const current = await adminTarget(session, id);
  const version = expectedVersion(req, current.version);
  const data = fields(input, EMPLOYEE_UPDATE_FIELDS).filter(
    (v) => v.value !== current[v.column],
  );
  if (!data.length) {
    res.json({ changed: false });
    return;
  }
  if (
    input.departmentId &&
    session.administeredDepartmentId &&
    input.departmentId !== session.administeredDepartmentId
  )
    throw new DemoHttpError(403, "FORBIDDEN");
  const move =
    input.departmentId && input.departmentId !== current.department_id
      ? input.departmentId
      : null;
  if (move) await activeDepartment(session, move);
  await write(session, [
    guardTarget(session, id),
    ...(move ? [guardDepartment(session, move)] : []),
    patch(
      "employees",
      [...data, { column: "updated_by", value: session.id }],
      "workspace_id=? AND id=? AND version=?",
      session.workspaceId,
      id,
      version,
    ),
    changedOne(),
    audit(session, "EMPLOYEE_UPDATED", "employee", id, undefined, {
      changedFields: data.map((v) => v.key),
    }),
  ]);
  res.json({ changed: true, employee: { id, version: version + 1 } });
});

router.patch(
  "/admin/employees/:employeeId/status",
  ...admin,
  async (req, res) => {
    const session = req.demoSession!;
    const id = parse(uuid, req.params.employeeId);
    const input = parse(updateStatusSchema, req.body);
    const current = await adminTarget(session, id);
    if (current.entry_persona || id === session.employeeRecordId)
      throw new DemoHttpError(409, "ENTRY_PERSONA_PROTECTED");
    if (!current.user_id && input.accountStatus)
      throw new DemoHttpError(409, "NO_ACCOUNT");
    const version = expectedVersion(req, current.version);
    const employment =
      input.employmentStatus ?? String(current.employment_status);
    const account =
      input.accountStatus ??
      (employment !== "ACTIVE" && current.account_status === "ACTIVE"
        ? "DISABLED"
        : (current.account_status as string | null));
    if (employment !== "ACTIVE" && account === "ACTIVE")
      throw new DemoHttpError(409, "STATUS_CONFLICT");
    if (
      employment === current.employment_status &&
      account === current.account_status
    ) {
      res.json({ changed: false });
      return;
    }
    await write(session, [
      guardTarget(session, id),
      patch(
        "employees",
        [
          { column: "employment_status", value: employment },
          { column: "updated_by", value: session.id },
        ],
        "workspace_id=? AND id=? AND version=?",
        session.workspaceId,
        id,
        version,
      ),
      changedOne(),
      ...(account !== current.account_status && current.user_id
        ? [
            patch(
              "users",
              [{ column: "account_status", value: account }],
              "workspace_id=? AND id=? AND version=?",
              session.workspaceId,
              String(current.user_id),
              current.account_version,
            ),
            changedOne(),
          ]
        : []),
      audit(session, "EMPLOYEE_STATUS_CHANGED", "employee", id, input.reason, {
        employmentStatus: employment,
        accountStatus: account,
      }),
    ]);
    res.json({ changed: true, employee: { id, version: version + 1 } });
  },
);

router.post("/admin/departments", ...admin, async (req, res) => {
  const session = req.demoSession!;
  if (session.adminScope !== "FULL") throw new DemoHttpError(403, "FORBIDDEN");
  const input = parse(createDepartmentSchema, req.body);
  const id = randomUUID();
  await write(session, [
    assertion(
      "(SELECT count(*) FROM departments WHERE workspace_id=?) < 30",
      session.workspaceId,
    ),
    statement(
      "INSERT INTO departments (workspace_id,id,name_en,name_bn) VALUES (?,?,?,?)",
      session.workspaceId,
      id,
      input.nameEn,
      input.nameBn,
    ),
    audit(session, "DEPARTMENT_CREATED", "department", id),
  ]);
  res
    .status(201)
    .json({
      department: {
        id,
        ...input,
        isActive: true,
        employeeCount: 0,
        version: 1,
      },
    });
});

router.patch("/admin/departments/:departmentId", ...admin, async (req, res) => {
  const session = req.demoSession!;
  if (session.adminScope !== "FULL") throw new DemoHttpError(403, "FORBIDDEN");
  const id = parse(uuid, req.params.departmentId);
  const input = parse(updateDepartmentSchema, req.body);
  const current = await statement(
    "SELECT * FROM departments WHERE workspace_id=? AND id=?",
    session.workspaceId,
    id,
  ).first<{
    name_en: string;
    name_bn: string | null;
    is_active: number;
    version: number;
  }>();
  if (!current) throw new DemoHttpError(404, "DEPARTMENT_NOT_FOUND");
  const version = expectedVersion(req, current.version);
  const next = {
    nameEn: input.nameEn ?? current.name_en,
    nameBn: input.nameBn === undefined ? current.name_bn : input.nameBn || null,
    isActive: input.isActive ?? Boolean(current.is_active),
  };
  await write(session, [
    patch(
      "departments",
      [
        { column: "name_en", value: next.nameEn },
        { column: "name_bn", value: next.nameBn },
        { column: "is_active", value: Number(next.isActive) },
      ],
      "workspace_id=? AND id=? AND version=?",
      session.workspaceId,
      id,
      version,
    ),
    changedOne(),
    audit(session, "DEPARTMENT_UPDATED", "department", id),
  ]);
  res.json({
    changed: true,
    department: { id, ...next, version: version + 1 },
  });
});

export default router;
