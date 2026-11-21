import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  RECORD_SECTIONS_BY_SLUG,
  dateRangeProblem,
  type RecordSection,
} from "../src/records/sections.js";
import { upsertSpouseSchema } from "../src/spouse/schemas.js";
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

export const spouseFields = [
  { key: "spouseName", column: "spouse_name" },
  { key: "spouseOccupation", column: "spouse_occupation" },
  { key: "spouseDateOfBirth", column: "spouse_date_of_birth" },
  { key: "spouseNationalId", column: "spouse_national_id" },
] as const;
export type RecordRow = Record<string, string | number | null> & {
  id: string;
  version: number;
};
export function pdsRecord(
  session: DemoSession,
  table: string,
  employeeId: string,
  id?: string,
) {
  return statement(
    "SELECT * FROM " +
      table +
      " WHERE workspace_id=? AND employee_id=?" +
      (id ? " AND id=?" : ""),
    session.workspaceId,
    employeeId,
    ...(id ? [id] : []),
  ).first<RecordRow>();
}
export function recordValues(
  row: RecordRow,
  mapping: readonly { key: string; column: string }[],
) {
  return Object.fromEntries(mapping.map((f) => [f.key, row[f.column] ?? null]));
}
export function sectionOf(slug: string) {
  const section = RECORD_SECTIONS_BY_SLUG.get(slug);
  if (!section) throw new DemoHttpError(404, "SECTION_NOT_FOUND");
  return section;
}
export async function recordGuards(
  session: DemoSession,
  section: RecordSection,
  input: Record<string, unknown>,
) {
  if (dateRangeProblem(section, input))
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  if (typeof input.departmentId === "string") {
    await activeDepartment(session, input.departmentId);
    return [guardDepartment(session, input.departmentId)];
  }
  return [];
}
export function insertRecord(
  session: DemoSession,
  table: string,
  employeeId: string,
  id: string,
  data: ReturnType<typeof fields>,
) {
  return [
    assertion(
      `(SELECT count(*) FROM ${table} WHERE workspace_id=? AND employee_id=?) < 30`,
      session.workspaceId,
      employeeId,
    ),
    statement(
      `INSERT INTO ${table} (workspace_id,id,employee_id,${data.map((v) => v.column).join(",")})
      VALUES (?,?,?,${data.map(() => "?").join(",")})`,
      session.workspaceId,
      id,
      employeeId,
      ...data.map((v) => v.value),
    ),
  ];
}
const admin = [requireDemoAuth, requireDemoAdmin, requireDemoCsrf];
const router = Router();
const records = "/admin/employees/:employeeId/records/:section";
const spouse = "/admin/employees/:employeeId/spouse";

router.post(records, ...admin, async (req, res) => {
  const session = req.demoSession!;
  const employeeId = parse(uuid, req.params.employeeId);
  await adminTarget(session, employeeId);
  const section = sectionOf(String(req.params.section));
  const data = parse(section.createSchema, req.body) as Record<string, unknown>;
  const id = randomUUID();
  await write(session, [
    guardTarget(session, employeeId),
    ...(await recordGuards(session, section, data)),
    ...insertRecord(
      session,
      section.table,
      employeeId,
      id,
      fields(data, section.fields),
    ),
    audit(session, "PDS_RECORD_CREATED", section.slug, id),
  ]);
  res.status(201).json({ record: { id, ...data, version: 1 } });
});

router.patch(records + "/:recordId", ...admin, async (req, res) => {
  const session = req.demoSession!;
  const employeeId = parse(uuid, req.params.employeeId);
  const id = parse(uuid, req.params.recordId);
  await adminTarget(session, employeeId);
  const section = sectionOf(String(req.params.section));
  const input = parse(section.updateSchema, req.body) as Record<
    string,
    unknown
  >;
  const current = await pdsRecord(session, section.table, employeeId, id);
  if (!current) throw new DemoHttpError(404, "RECORD_NOT_FOUND");
  const version = expectedVersion(req, current.version);
  const data = fields(input, section.fields);
  const merged = {
    ...recordValues(current, section.fields),
    ...Object.fromEntries(data.map((v) => [v.key, v.value])),
  };
  if (dateRangeProblem(section, merged))
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  await write(session, [
    guardTarget(session, employeeId),
    ...(await recordGuards(session, section, input)),
    patch(
      section.table,
      data,
      "workspace_id=? AND employee_id=? AND id=? AND version=?",
      session.workspaceId,
      employeeId,
      id,
      version,
    ),
    changedOne(),
    audit(session, "PDS_RECORD_UPDATED", section.slug, id),
  ]);
  res.json({ record: { id, ...merged, version: version + 1 }, changed: true });
});

router.delete(records + "/:recordId", ...admin, async (req, res) => {
  const session = req.demoSession!;
  const employeeId = parse(uuid, req.params.employeeId);
  const id = parse(uuid, req.params.recordId);
  await adminTarget(session, employeeId);
  const section = sectionOf(String(req.params.section));
  const current = await pdsRecord(session, section.table, employeeId, id);
  if (!current) throw new DemoHttpError(404, "RECORD_NOT_FOUND");
  await write(session, [
    guardTarget(session, employeeId),
    statement(
      `DELETE FROM ${section.table}
    WHERE workspace_id=? AND employee_id=? AND id=? AND version=?`,
      session.workspaceId,
      employeeId,
      id,
      expectedVersion(req, current.version),
    ),
    changedOne(),
    audit(session, "PDS_RECORD_DELETED", section.slug, id),
  ]);
  res.status(204).end();
});

router.put(spouse, ...admin, async (req, res) => {
  const session = req.demoSession!;
  const employeeId = parse(uuid, req.params.employeeId);
  const owner = await adminTarget(session, employeeId);
  if (owner.marital_status !== "MARRIED")
    throw new DemoHttpError(409, "SPOUSE_REQUIRES_MARRIED");
  const input = parse(upsertSpouseSchema, req.body);
  const current = await pdsRecord(session, "employee_spouse", employeeId);
  if (!current && req.get("If-Match"))
    throw new DemoHttpError(409, "CHANGE_CONFLICT");
  const id = current?.id ?? randomUUID();
  const data = fields(input, spouseFields);
  await write(session, [
    guardTarget(session, employeeId),
    ...(current
      ? [
          patch(
            "employee_spouse",
            data,
            "workspace_id=? AND employee_id=? AND id=? AND version=?",
            session.workspaceId,
            employeeId,
            id,
            expectedVersion(req, current.version),
          ),
          changedOne(),
        ]
      : insertRecord(session, "employee_spouse", employeeId, id, data)),
    audit(session, current ? "SPOUSE_UPDATED" : "SPOUSE_CREATED", "spouse", id),
  ]);
  res
    .status(current ? 200 : 201)
    .json({ spouse: { id, ...input, version: (current?.version ?? 0) + 1 } });
});

router.delete(spouse, ...admin, async (req, res) => {
  const session = req.demoSession!;
  const employeeId = parse(uuid, req.params.employeeId);
  await adminTarget(session, employeeId);
  const current = await pdsRecord(session, "employee_spouse", employeeId);
  if (!current) throw new DemoHttpError(404, "SPOUSE_NOT_FOUND");
  await write(session, [
    guardTarget(session, employeeId),
    statement(
      `DELETE FROM employee_spouse
    WHERE workspace_id=? AND employee_id=? AND id=? AND version=?`,
      session.workspaceId,
      employeeId,
      current.id,
      expectedVersion(req, current.version),
    ),
    changedOne(),
    audit(session, "SPOUSE_DELETED", "spouse", current.id),
  ]);
  res.status(204).end();
});
export default router;
