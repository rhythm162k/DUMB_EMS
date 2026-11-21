import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { updateEmployeeSchema } from "../src/employees/schemas.js";
import { EMPLOYEE_UPDATE_FIELDS } from "../src/employees/updates.js";
import { dateRangeProblem } from "../src/records/sections.js";
import { upsertSpouseSchema } from "../src/spouse/schemas.js";
import {
  insertRecord,
  pdsRecord,
  recordGuards,
  recordValues,
  sectionOf,
  spouseFields,
} from "./pds.js";
import {
  DemoHttpError,
  requireDemoAdmin,
  requireDemoAuth,
  requireDemoCsrf,
  type DemoSession,
} from "./session.js";
import {
  checkAdminTarget,
  assertion,
  audit,
  changedOne,
  employee,
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

const profileFields = EMPLOYEE_UPDATE_FIELDS.filter((f) =>
  [
    "gender",
    "bloodGroup",
    "dateOfBirth",
    "phone",
    "email",
    "presentAddress",
    "permanentAddress",
    "religion",
    "maritalStatus",
    "designation",
    "joiningDate",
  ].includes(f.key),
);
const proposal = z.discriminatedUnion("targetRecordType", [
  z.strictObject({
    targetRecordType: z.literal("PROFILE"),
    operation: z.literal("UPDATE"),
    fieldKey: z.string(),
    proposedValue: z.unknown(),
  }),
  z.strictObject({
    targetRecordType: z.literal("SPOUSE"),
    operation: z.enum(["CREATE", "UPDATE"]),
    fieldKey: z.string().optional(),
    proposedValue: z.unknown(),
  }),
  z.strictObject({
    targetRecordType: z.literal("PDS"),
    section: z.string(),
    operation: z.enum(["CREATE", "UPDATE", "DELETE"]),
    targetRecordId: uuid.optional(),
    fieldKey: z.string().optional(),
    proposedValue: z.unknown().optional(),
  }),
]);
type Proposal = z.infer<typeof proposal>;
const decision = z.strictObject({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(1000).optional(),
});
type Saved = {
  employee_id: string;
  field_key: string;
  target_record_type: string;
  target_record_id: string | null;
  operation: Proposal["operation"];
  old_value_snapshot: string | null;
  proposed_value: string;
  status: string;
  version: number;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const missing = () => new DemoHttpError(409, "CHANGE_CONFLICT");

async function prepareChange(
  session: DemoSession,
  employeeId: string,
  input: Proposal,
  checkedOwner?: Record<string, unknown> & { version: number },
) {
  const owner = checkedOwner ?? (await employee(session, employeeId));
  if (!owner) throw missing();
  if (input.operation !== "DELETE" && input.proposedValue === undefined)
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  if (input.targetRecordType === "PROFILE") {
    const field = profileFields.find((f) => f.key === input.fieldKey);
    if (!field) throw new DemoHttpError(400, "VALIDATION_ERROR");
    const data = fields(
      parse(updateEmployeeSchema, { [field.key]: input.proposedValue }),
      [field],
    );
    if (!data.length) throw new DemoHttpError(400, "VALIDATION_ERROR");
    return {
      type: "PROFILE",
      key: field.key,
      id: null,
      old: owner[field.column] ?? null,
      value: data[0]!.value,
      guard: assertion(
        "EXISTS (SELECT 1 FROM employees WHERE workspace_id=? AND id=? AND version=?)",
        session.workspaceId,
        employeeId,
        owner.version,
      ),
      apply: [
        patch(
          "employees",
          [...data, { column: "updated_by", value: session.id }],
          "workspace_id=? AND id=? AND version=?",
          session.workspaceId,
          employeeId,
          owner.version,
        ),
        changedOne(),
      ],
    };
  }

  const section =
    input.targetRecordType === "PDS" ? sectionOf(input.section) : null;
  const table = section?.table ?? "employee_spouse";
  const mapping = section?.fields ?? spouseFields;
  const type = section ? "PDS:" + section.slug : "SPOUSE";
  const id =
    input.targetRecordType === "PDS" ? input.targetRecordId : undefined;
  if (section && (input.operation === "CREATE") === Boolean(id))
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  if (!section && owner.marital_status !== "MARRIED")
    throw new DemoHttpError(409, "SPOUSE_REQUIRES_MARRIED");
  const row =
    input.operation !== "CREATE" || !section
      ? await pdsRecord(session, table, employeeId, id)
      : null;
  if (input.operation === "CREATE") {
    if (input.fieldKey) throw new DemoHttpError(400, "VALIDATION_ERROR");
    if (row) throw missing();
    const value = parse(
      section?.createSchema ?? upsertSpouseSchema,
      input.proposedValue,
    ) as Record<string, unknown>;
    const guards = section ? await recordGuards(session, section, value) : [];
    return {
      type,
      key: section?.slug ?? "spouse",
      id: null,
      old: null,
      value,
      guard: section
        ? null
        : assertion(
            "NOT EXISTS (SELECT 1 FROM employee_spouse WHERE workspace_id=? AND employee_id=?)",
            session.workspaceId,
            employeeId,
          ),
      apply: [
        ...guards,
        ...insertRecord(
          session,
          table,
          employeeId,
          randomUUID(),
          fields(value, mapping),
        ),
      ],
    };
  }
  if (!row) throw missing();
  const current = recordValues(row, mapping);
  const guard = assertion(
    `EXISTS (SELECT 1 FROM ${table} WHERE workspace_id=? AND employee_id=? AND id=? AND version=?)`,
    session.workspaceId,
    employeeId,
    row.id,
    row.version,
  );
  if (input.operation === "DELETE") {
    if (input.fieldKey || input.proposedValue !== undefined)
      throw new DemoHttpError(400, "VALIDATION_ERROR");
    return {
      type,
      key: section!.slug,
      id: row.id,
      old: current,
      value: null,
      guard,
      apply: [
        statement(
          `DELETE FROM ${table} WHERE workspace_id=? AND employee_id=? AND id=? AND version=?`,
          session.workspaceId,
          employeeId,
          row.id,
          row.version,
        ),
        changedOne(),
      ],
    };
  }
  const field = mapping.find((f) => f.key === input.fieldKey);
  if (!field) throw new DemoHttpError(400, "VALIDATION_ERROR");
  const next = section
    ? parse(section.updateSchema, { [field.key]: input.proposedValue })
    : parse(upsertSpouseSchema, {
        ...current,
        [field.key]: input.proposedValue,
      });
  const value = fields(next as object, [field])[0]?.value;
  if (value === undefined) throw new DemoHttpError(400, "VALIDATION_ERROR");
  if (section && dateRangeProblem(section, { ...current, [field.key]: value }))
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  const guards = section
    ? await recordGuards(session, section, { [field.key]: value })
    : [];
  return {
    type,
    key: field.key,
    id: row.id,
    old: current[field.key],
    value,
    guard,
    apply: [
      ...guards,
      patch(
        table,
        [{ column: field.column, value }],
        "workspace_id=? AND employee_id=? AND id=? AND version=?",
        session.workspaceId,
        employeeId,
        row.id,
        row.version,
      ),
      changedOne(),
    ],
  };
}

const router = Router();
router.post(
  "/me/change-requests",
  requireDemoAuth,
  requireDemoCsrf,
  async (req, res) => {
    const session = req.demoSession!;
    if (session.adminScope === "FULL")
      throw new DemoHttpError(403, "FORBIDDEN");
    const input = parse(proposal, req.body),
      id = randomUUID();
    const item = await prepareChange(session, session.employeeRecordId, input);
    if (input.operation === "UPDATE" && same(item.old, item.value))
      throw new DemoHttpError(409, "NO_CHANGE");
    await write(session, [
      ...(item.guard ? [item.guard] : []),
      assertion(
        "(SELECT count(*) FROM change_requests WHERE workspace_id=? AND employee_id=?) < 100",
        session.workspaceId,
        session.employeeRecordId,
      ),
      statement(
        `INSERT INTO change_requests (workspace_id,id,employee_id,submitted_by_user_id,field_key,target_record_type,
      target_record_id,operation,old_value_snapshot,proposed_value) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        session.workspaceId,
        id,
        session.employeeRecordId,
        session.id,
        item.key,
        item.type,
        item.id,
        input.operation,
        JSON.stringify(item.old ?? null),
        JSON.stringify(item.value ?? null),
      ),
      audit(session, "CHANGE_REQUEST_SUBMITTED", "change_request", id),
    ]);
    res.status(201).json({ id, status: "PENDING" });
  },
);
router.post(
  "/me/change-requests/:requestId/withdraw",
  requireDemoAuth,
  requireDemoCsrf,
  async (req, res) => {
    const session = req.demoSession!,
      id = parse(uuid, req.params.requestId);
    await write(session, [
      statement(
        `UPDATE change_requests SET status='WITHDRAWN',withdrawn_at=${stamp},version=version+1
    WHERE workspace_id=? AND id=? AND employee_id=? AND status='PENDING'`,
        session.workspaceId,
        id,
        session.employeeRecordId,
      ),
      changedOne(),
      audit(session, "CHANGE_REQUEST_WITHDRAWN", "change_request", id),
    ]);
    res.json({ id, status: "WITHDRAWN" });
  },
);
router.post(
  "/admin/change-requests/:requestId/decision",
  requireDemoAuth,
  requireDemoAdmin,
  requireDemoCsrf,
  async (req, res) => {
    const session = req.demoSession!,
      id = parse(uuid, req.params.requestId);
    const input = parse(decision, req.body);
    if (input.action === "REJECT" && !input.reason)
      throw new DemoHttpError(400, "VALIDATION_ERROR");
    const row = await statement(
      `SELECT r.employee_id,r.field_key,r.target_record_type,r.target_record_id,r.operation,
        r.old_value_snapshot,r.proposed_value,r.status,r.version,
        e.version AS employee_version,e.department_id,
        ${profileFields.map(({ column }) => "e." + column).join(",")},
        u.role AS account_role,u.is_root
      FROM change_requests r
      JOIN employees e ON e.workspace_id=r.workspace_id AND e.id=r.employee_id
      LEFT JOIN users u ON u.workspace_id=e.workspace_id AND u.employee_id=e.id
      WHERE r.workspace_id=? AND r.id=?`,
      session.workspaceId,
      id,
    ).first<
      Saved &
        Record<string, unknown> & {
          employee_version: number;
          department_id: string;
          account_role: string | null;
          is_root: number | null;
        }
    >();
    if (!row) throw new DemoHttpError(404, "NOT_FOUND");
    checkAdminTarget(session, row);
    if (row.status !== "PENDING") throw missing();
    const version = expectedVersion(req, row.version);
    const outcome = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
    let apply: D1PreparedStatement[] = [];
    if (input.action === "APPROVE") {
      const type = row.target_record_type;
      const proposedValue = JSON.parse(row.proposed_value);
      const payload =
        type === "PROFILE"
          ? {
              targetRecordType: type,
              operation: row.operation,
              fieldKey: row.field_key,
              proposedValue,
            }
          : type === "SPOUSE"
            ? {
                targetRecordType: type,
                operation: row.operation,
                ...(row.operation === "UPDATE"
                  ? { fieldKey: row.field_key }
                  : {}),
                proposedValue,
              }
            : {
                targetRecordType: "PDS",
                section: type.slice(4),
                operation: row.operation,
                targetRecordId: row.target_record_id ?? undefined,
                ...(row.operation === "UPDATE"
                  ? { fieldKey: row.field_key, proposedValue }
                  : row.operation === "CREATE"
                    ? { proposedValue }
                    : {}),
              };
      const change = await prepareChange(
        session,
        row.employee_id,
        parse(proposal, payload),
        { ...row, version: row.employee_version },
      );
      if (
        change.id !== row.target_record_id ||
        !same(
          change.old,
          row.old_value_snapshot === null
            ? null
            : JSON.parse(row.old_value_snapshot),
        )
      )
        throw missing();
      apply = change.apply;
    }
    await write(session, [
      guardTarget(session, row.employee_id),
      statement(
        `UPDATE change_requests SET status=?,reviewed_at=${stamp},
    reviewed_by_user_id=?,rejection_reason=?,version=version+1 WHERE workspace_id=? AND id=? AND version=? AND status='PENDING'`,
        outcome,
        session.id,
        input.action === "REJECT" ? (input.reason ?? null) : null,
        session.workspaceId,
        id,
        version,
      ),
      changedOne(),
      ...apply,
      audit(
        session,
        "CHANGE_REQUEST_" + outcome,
        "change_request",
        id,
        input.reason,
      ),
    ]);
    res.json({ id, status: outcome });
  },
);
export default router;
