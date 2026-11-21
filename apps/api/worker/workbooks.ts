import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import { Router } from "express";
import { z } from "zod";
import { allColumns, sheetsFor } from "../src/data/columns.js";
import { friendlyRowErrors } from "../src/data/import-messages.js";
import {
  templateCsvDefinition,
  templateSheets,
} from "../src/data/template-data.js";
import { validateImportRows } from "../src/data/validate-import.js";
import type { DataRow } from "../src/data/workbook.js";
import { EMPLOYEE_UPDATE_FIELDS } from "../src/employees/updates.js";
import {
  RECORD_SECTIONS,
  RECORD_SECTIONS_BY_SLUG,
} from "../src/records/sections.js";
import { insertRecord, spouseFields } from "./pds.js";
import {
  DemoHttpError,
  requireDemoAdmin,
  requireDemoAuth,
  requireDemoCsrf,
  type DemoSession,
} from "./session.js";
import {
  assertion,
  audit,
  changedOne,
  fields,
  guardDepartment,
  guardTarget,
  parse,
  patch,
  stamp,
  statement,
  uuid,
  write,
} from "./writes.js";

const router = Router();
const adminWrite = [requireDemoAuth, requireDemoAdmin, requireDemoCsrf];
const maxRows = 12;
const rowSchema = z
  .record(z.string().max(60), z.string().max(2000))
  .refine((row) => Object.keys(row).length <= 100);
const upload = z.strictObject({ rows: z.array(rowSchema).min(1).max(maxRows) });
const commit = z.strictObject({
  previewId: uuid,
  selected: z
    .array(
      z
        .number()
        .int()
        .min(2)
        .max(maxRows + 1),
    )
    .min(1)
    .max(maxRows),
});
const format = z.enum(["csv", "xlsx"]).default("xlsx");
const exportQuery = z.strictObject({
  format,
  q: z.string().trim().max(100).optional(),
  departmentId: uuid.optional(),
  employmentStatus: z
    .enum([
      "ACTIVE",
      "TRANSFERRED_OUT",
      "RETIRED",
      "RESIGNED",
      "SUSPENDED",
      "DECEASED",
    ])
    .optional(),
  ids: z.string().max(2300).optional(),
  sensitive: z.enum(["true", "false"]).default("false"),
});
const related = [
  { table: "employee_spouse", fields: spouseFields, slug: "SPOUSE" },
  ...RECORD_SECTIONS,
];
type Row = Record<string, string | number | null> & {
  id: string;
  version: number;
  updated_at: string;
  employee_id: string;
  official_employee_id: string;
};
const token = (row: Row) => row.updated_at + "@" + row.version;
const scope = (session: DemoSession) =>
  session.administeredDepartmentId
    ? ` AND e.department_id=? AND NOT EXISTS
  (SELECT 1 FROM users u WHERE u.workspace_id=e.workspace_id AND u.employee_id=e.id AND u.role='ADMIN')`
    : "";
const scopeArgs = (session: DemoSession) =>
  session.administeredDepartmentId ? [session.administeredDepartmentId] : [];

async function validateRows(session: DemoSession, rows: DataRow[]) {
  const codes = JSON.stringify([
    ...new Set(rows.map((r) => r.officialEmployeeId ?? "")),
  ]);
  const needed = related.filter((r) =>
    rows.some((input) => input.rowType === r.slug),
  );
  const db = env.DB;
  // Prefetch the scoped target records once, with only the eligible employee and record IDs.
  const selected = `SELECT e.id FROM employees e WHERE e.workspace_id=? ${scope(session)}
    AND e.official_employee_id IN (SELECT value FROM json_each(?))`;
  const args = [session.workspaceId, ...scopeArgs(session), codes];
  const recordIds = JSON.stringify(
    rows.flatMap((row) => (row.recordId ? [row.recordId] : [])),
  );
  const [employees, depts, ...child] = await db.batch<Row>([
    statement(
      `SELECT e.*,u.is_root FROM employees e LEFT JOIN users u ON u.workspace_id=e.workspace_id AND u.employee_id=e.id
      WHERE e.id IN (${selected}) AND e.workspace_id=?`,
      ...args,
      session.workspaceId,
    ),
    statement(
      "SELECT id FROM departments WHERE workspace_id=? AND is_active=1",
      session.workspaceId,
    ),
    ...needed.map((s) =>
      statement(
        `SELECT * FROM ${s.table} WHERE workspace_id=? AND employee_id IN (${selected})
      ${s.slug === "SPOUSE" ? "" : "AND id IN (SELECT value FROM json_each(?))"}`,
        session.workspaceId,
        ...args,
        ...(s.slug === "SPOUSE" ? [] : [recordIds]),
      ),
    ),
  ]);
  const byCode = new Map(
    (employees?.results ?? []).map((row) => [row.official_employee_id, row]),
  );
  const roots = new Set(
    (employees?.results ?? [])
      .filter((row) => row.is_root === 1)
      .map((row) => row.id),
  );
  const active = new Set((depts?.results ?? []).map((row) => row.id));
  const tables = new Map(
    needed.map((s, i) => [s.table, child[i]?.results ?? []]),
  );
  const record = (table: string, employeeId: string, id: string) =>
    tables
      .get(table)
      ?.find((row) => row.employee_id === employeeId && row.id === id);
  const result = await validateImportRows(
    {
      employee: (code) => {
        const e = byCode.get(code);
        return e && { ...e, updated_at: token(e) };
      },
      isRoot: (id) => roots.has(id),
      record: (table, employeeId, id) => {
        const r = record(table, employeeId, id);
        return r && { ...r, updated_at: token(r) };
      },
      hasSpouse: (employeeId) =>
        tables
          .get("employee_spouse")
          ?.some((s) => s.employee_id === employeeId) ?? false,
      activeDepartment: (id) => active.has(id),
    },
    rows,
    session.administeredDepartmentId,
    !session.isRoot,
  );
  return { result, byCode, record };
}

router.get(
  "/admin/data/template",
  requireDemoAuth,
  requireDemoAdmin,
  async (req, res) => {
    const session = req.demoSession!,
      kind = parse(format, req.query.format);
    const list = await statement(
      `SELECT id,name_en FROM departments WHERE workspace_id=? AND is_active=1
    ${session.administeredDepartmentId ? "AND id=?" : ""} ORDER BY name_en`,
      session.workspaceId,
      ...scopeArgs(session),
    ).all<{ id: string; name_en: string }>();
    res.json(
      kind === "xlsx"
        ? { sheets: templateSheets(list.results) }
        : templateCsvDefinition(list.results),
    );
  },
);

router.post("/admin/data/files/preview", ...adminWrite, async (req, res) => {
  const session = req.demoSession!,
    { rows } = parse(upload, req.body),
    id = randomUUID();
  const { result } = await validateRows(session, rows);
  await write(session, [
    statement(
      `DELETE FROM import_previews WHERE workspace_id=? AND actor_user_id=? AND id IN
      (SELECT id FROM import_previews WHERE workspace_id=? AND actor_user_id=?
        ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 4)`,
      session.workspaceId,
      session.id,
      session.workspaceId,
      session.id,
    ),
    statement(
      "INSERT INTO import_previews (workspace_id,id,actor_user_id,rows_data) VALUES (?,?,?,?)",
      session.workspaceId,
      id,
      session.id,
      JSON.stringify(rows),
    ),
    audit(session, "IMPORT_PREVIEWED", "import", id, undefined, {
      rowCount: rows.length,
    }),
  ]);
  res.json({
    previewId: id,
    expiresInMinutes: 20,
    results: result.map((row) => ({
      row: row.row,
      valid: row.valid,
      ...friendlyRowErrors(row.errors),
      employeeId: row.data.officialEmployeeId,
      rowType: row.data.rowType,
      action: row.data.action,
    })),
  });
});

router.post("/admin/data/files/commit", ...adminWrite, async (req, res) => {
  const session = req.demoSession!,
    input = parse(commit, req.body);
  const preview = await statement(
    `SELECT rows_data FROM import_previews WHERE workspace_id=? AND id=? AND actor_user_id=?
    AND consumed_at IS NULL AND expires_at>${stamp}`,
    session.workspaceId,
    input.previewId,
    session.id,
  ).first<string>("rows_data");
  if (!preview) throw new DemoHttpError(409, "PREVIEW_UNAVAILABLE");
  const all = JSON.parse(preview) as DataRow[];
  const selection = [...new Set(input.selected)].map((n) => all[n - 2]);
  if (selection.some((r) => !r))
    throw new DemoHttpError(400, "VALIDATION_ERROR");
  const { result, byCode, record } = await validateRows(
    session,
    selection as DataRow[],
  );
  if (result.some((r) => !r.valid))
    throw new DemoHttpError(409, "IMPORT_CONFLICT");
  const ids = new Map<string, string>();
  const changes = [
    statement(
      `UPDATE import_previews SET consumed_at=${stamp},rows_data='[]' WHERE workspace_id=? AND id=? AND actor_user_id=?
      AND consumed_at IS NULL AND expires_at>${stamp}`,
      session.workspaceId,
      input.previewId,
      session.id,
    ),
    changedOne(),
  ];
  const newProfiles = result
    .filter(
      ({ data }) => data.rowType === "PROFILE" && data.action === "CREATE",
    )
    .map(({ data, payload }) => {
      const id = randomUUID();
      ids.set(data.officialEmployeeId!, id);
      return {
        id,
        userId: randomUUID(),
        auditId: randomUUID(),
        payload: payload!,
      };
    });
  if (newProfiles.length) {
    // Send profile fields to D1 once. The other statements only need foreign keys.
    const profileKeys = JSON.stringify(
      newProfiles.map(({ id, userId, auditId, payload }) => ({
        id,
        userId,
        auditId,
        departmentId: payload.departmentId,
      })),
    );
    changes.push(
      assertion(
        "(SELECT count(*) FROM employees WHERE workspace_id=?) + ? <= 60",
        session.workspaceId,
        newProfiles.length,
      ),
      assertion(
        `NOT EXISTS (SELECT 1 FROM json_each(?1) j WHERE NOT EXISTS (
        SELECT 1 FROM departments d WHERE d.workspace_id=?2 AND d.id=json_extract(j.value,'$.departmentId')
          AND d.is_active=1 AND (?3 IS NULL OR d.id=?3)
      ))`,
        profileKeys,
        session.workspaceId,
        session.administeredDepartmentId,
      ),
      statement(
        `INSERT INTO employees (workspace_id,id,official_employee_id,created_by,updated_by,
        ${EMPLOYEE_UPDATE_FIELDS.map((f) => f.column).join(",")})
        SELECT ?1,json_extract(j.value,'$.id'),json_extract(j.value,'$.officialEmployeeId'),?2,?2,
          ${EMPLOYEE_UPDATE_FIELDS.map((f) => "json_extract(j.value,'$." + f.key + "')").join(",")}
        FROM json_each(?3) j`,
        session.workspaceId,
        session.id,
        JSON.stringify(
          newProfiles.map(({ id, payload }) => ({ id, ...payload })),
        ),
      ),
      statement(
        `INSERT INTO users (workspace_id,id,employee_id,role)
        SELECT ?,json_extract(j.value,'$.userId'),json_extract(j.value,'$.id'),'EMPLOYEE' FROM json_each(?) j`,
        session.workspaceId,
        profileKeys,
      ),
      statement(
        `INSERT INTO audit_logs (workspace_id,id,actor_user_id,actor_role,action,entity_type,entity_id,metadata)
        SELECT ?1,json_extract(j.value,'$.auditId'),?2,'ADMIN','DATA_IMPORTED','employee',
          json_extract(j.value,'$.id'),json_object('rowType','PROFILE','operation','CREATE','batchId',?3)
        FROM json_each(?4) j`,
        session.workspaceId,
        session.id,
        input.previewId,
        profileKeys,
      ),
    );
  }
  // A profile now exists for any dependent row selected from a different sheet.
  for (const row of result.sort(
    (a, b) =>
      Number(b.data.rowType === "PROFILE") -
      Number(a.data.rowType === "PROFILE"),
  )) {
    const { officialEmployeeId: code, rowType, action, recordId } = row.data;
    if (rowType === "PROFILE" && action === "CREATE") continue;
    const payload = row.payload!;
    const current = byCode.get(code!);
    const owner = current?.id ?? ids.get(code!);
    if (!owner) throw new DemoHttpError(409, "IMPORT_CONFLICT");
    if (current) changes.push(guardTarget(session, owner));
    if (typeof payload.departmentId === "string") {
      if (
        session.administeredDepartmentId &&
        payload.departmentId !== session.administeredDepartmentId
      )
        throw new DemoHttpError(403, "FORBIDDEN");
      changes.push(guardDepartment(session, payload.departmentId));
    }
    const section = RECORD_SECTIONS_BY_SLUG.get(rowType!);
    const table =
      rowType === "PROFILE"
        ? "employees"
        : rowType === "SPOUSE"
          ? "employee_spouse"
          : section!.table;
    const mapping =
      rowType === "PROFILE"
        ? EMPLOYEE_UPDATE_FIELDS
        : rowType === "SPOUSE"
          ? spouseFields
          : section!.fields;
    const data = fields(payload, mapping);
    if (action === "CREATE")
      changes.push(...insertRecord(session, table, owner, randomUUID(), data));
    else {
      const target =
        rowType === "PROFILE" ? current : record(table, owner, recordId!);
      if (!target || !data.length)
        throw new DemoHttpError(409, "IMPORT_CONFLICT");
      changes.push(
        patch(
          table,
          data,
          "workspace_id=? AND id=? AND version=?",
          session.workspaceId,
          target.id,
          target.version,
        ),
        changedOne(),
      );
    }
    changes.push(
      audit(session, "DATA_IMPORTED", "employee", owner, undefined, {
        rowType,
        operation: action,
        batchId: input.previewId,
      }),
    );
  }
  await write(session, changes);
  res.json({ count: selection.length, credentials: [] });
});

const privateProfile = new Set([
  "nationalId",
  "dateOfBirth",
  "phone",
  "email",
  "presentAddress",
  "permanentAddress",
  "fatherName",
  "motherName",
]);
const privateSpouse = new Set(["spouseNationalId", "spouseDateOfBirth"]);
const exportValue = (value: unknown, redact: boolean) =>
  value === null || value === undefined || value === ""
    ? ""
    : redact
      ? "[MASKED]"
      : String(value);
for (const [path, self] of [
  ["/me/data/pds", true],
  ["/admin/data/pds", false],
] as const) {
  router.post(
    path,
    requireDemoAuth,
    ...(self ? [] : [requireDemoAdmin]),
    requireDemoCsrf,
    async (req, res) => {
      const session = req.demoSession!,
        options = parse(exportQuery, req.body);
      const sensitive = options.sensitive === "true";
      if (
        self &&
        (sensitive ||
          options.ids ||
          options.q ||
          options.departmentId ||
          options.employmentStatus)
      )
        throw new DemoHttpError(403, "FORBIDDEN");
      if (
        session.administeredDepartmentId &&
        options.departmentId &&
        session.administeredDepartmentId !== options.departmentId
      )
        throw new DemoHttpError(403, "FORBIDDEN");
      const args: [...(string | number)[]] = [
        session.workspaceId,
        ...(self ? [session.employeeRecordId] : scopeArgs(session)),
      ];
      let where = "e.workspace_id=?" + (self ? " AND e.id=?" : scope(session));
      if (options.ids !== undefined) {
        const ids = parse(z.array(uuid).min(1).max(60), options.ids.split(","));
        where += " AND e.id IN (SELECT value FROM json_each(?))";
        args.push(JSON.stringify(ids));
      }
      if (options.departmentId) {
        where += " AND e.department_id=?";
        args.push(options.departmentId);
      }
      if (options.employmentStatus) {
        where += " AND e.employment_status=?";
        args.push(options.employmentStatus);
      }
      if (options.q) {
        where += ` AND instr(lower(e.official_employee_id || ' ' || e.first_name_en || ' ' ||
      coalesce(e.last_name_en,'') || ' ' || coalesce(e.full_name_bn,'')),lower(?))>0`;
        args.push(options.q);
      }
      const selected = `SELECT e.id FROM employees e WHERE ${where}`;
      const [people, ...children] = await env.DB.batch<Row>([
        statement(
          `SELECT e.*,d.name_en AS department_name_en,d.name_bn AS department_name_bn FROM employees e
        LEFT JOIN departments d ON d.workspace_id=e.workspace_id AND d.id=e.department_id WHERE ${where} ORDER BY e.official_employee_id`,
          ...args,
        ),
        ...related.map((s) =>
          statement(
            `SELECT * FROM ${s.table} WHERE workspace_id=? AND employee_id IN (${selected})
        ORDER BY employee_id,id LIMIT 301`,
            session.workspaceId,
            ...args,
          ),
        ),
      ]);
      if (!people?.results.length) throw new DemoHttpError(404, "NOT_FOUND");
      if (
        people.results.length +
          children.reduce((n, c) => n + c.results.length, 0) >
        300
      )
        throw new DemoHttpError(400, "EXPORT_LIMIT");
      const rows: DataRow[] = [];
      const codes = new Map(
        people.results.map((row) => [row.id, row.official_employee_id]),
      );
      for (const row of people.results) {
        const data: DataRow = {
          rowType: "PROFILE",
          action: "UPDATE",
          recordId: "",
          expectedUpdatedAt: token(row),
          officialEmployeeId: row.official_employee_id,
          employmentStatus: String(row.employment_status),
          departmentNameEn: exportValue(row.department_name_en, false),
          departmentNameBn: exportValue(row.department_name_bn, false),
        };
        for (const f of EMPLOYEE_UPDATE_FIELDS)
          data[f.key] = exportValue(
            row[f.column],
            !sensitive && privateProfile.has(f.key),
          );
        rows.push(data);
      }
      for (const [index, s] of related.entries())
        for (const row of children[index]?.results ?? []) {
          const data: DataRow = {
            rowType: s.slug,
            action: "UPDATE",
            recordId: row.id,
            expectedUpdatedAt: token(row),
            officialEmployeeId: codes.get(row.employee_id)!,
          };
          for (const f of s.fields)
            data[f.key] = exportValue(
              row[f.column],
              !sensitive && s.slug === "SPOUSE" && privateSpouse.has(f.key),
            );
          rows.push(data);
        }
      await write(session, [
        audit(
          session,
          self ? "PDS_SELF_EXPORTED" : "PDS_ADMIN_EXPORTED",
          "employee",
          self ? session.employeeRecordId : session.workspaceId,
          undefined,
          {
            format: options.format,
            employeeCount: people.results.length,
            unmasked: sensitive,
          },
        ),
      ]);
      res.json(
        options.format === "xlsx"
          ? { sheets: sheetsFor(rows) }
          : { columns: allColumns, rows },
      );
    },
  );
}
router.get(
  "/admin/data/audit",
  requireDemoAuth,
  requireDemoAdmin,
  async (req, res) => {
    const session = req.demoSession!;
    if (session.adminScope !== "FULL")
      throw new DemoHttpError(403, "FORBIDDEN");
    const page = parse(
      z.coerce.number().int().min(1).max(1000).default(1),
      req.query.page,
    );
    const result = await statement(
      `SELECT id, actor_role AS actorRole,action,entity_type AS entityType,entity_id AS entityId,
    field_key AS fieldKey,occurred_at AS occurredAt,reason FROM audit_logs WHERE workspace_id=?
    ORDER BY occurred_at DESC,id DESC LIMIT 50 OFFSET ?`,
      session.workspaceId,
      (page - 1) * 50,
    ).all();
    res.json({ items: result.results, page });
  },
);
export default router;
