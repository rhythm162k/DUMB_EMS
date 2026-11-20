import {
  departmentScope,
  employeeScopeSql,
  isRootAdmin,
} from "../auth/scope.js";
import express, { Router, type Request } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import {
  requireAuth,
  requireRole,
  requireActiveEmployee,
} from "../auth/middleware.js";
import { generateTemporaryPassword } from "../auth/security.js";
import { recordAudit } from "../audit/audit.js";
import { EMPLOYEE_UPDATE_FIELDS } from "../employees/updates.js";
import { RECORD_SECTIONS_BY_SLUG } from "../records/sections.js";
import {
  allColumns,
  exportRecords,
  sheetsFor,
  spouseFields,
  validateImport,
} from "../data/records.js";
import {
  readCsv,
  readXlsx,
  writeCsv,
  writeXlsx,
  type DataRow,
} from "../data/spreadsheets.js";
import { INVALID_ENTRY, friendlyRowErrors } from "../data/import-messages.js";
import { templateCsv, templateSheets } from "../data/import-template.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const bad = (message: string, code = "VALIDATION_ERROR") => ({
  error: { code, message },
});
const querySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
  q: z.string().trim().max(100).optional(),
  departmentId: z.string().uuid().optional(),
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
  ids: z.string().max(40000).optional(),
  sensitive: z.enum(["true", "false"]).default("false"),
});
const mime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function exported(req: Request, self: boolean) {
  const options = querySchema.parse(
    req.method === "POST" ? req.body : req.query,
  );
  if (
    self &&
    (options.ids ||
      options.q ||
      options.departmentId ||
      options.employmentStatus ||
      options.sensitive === "true")
  )
    throw new Error(
      "Self-export cannot select other employees or unmask sensitive fields.",
    );
  const ids = options.ids?.split(",").filter(Boolean);
  if (
    ids &&
    (!ids.length ||
      ids.length > 1000 ||
      ids.some((id) => !z.string().uuid().safeParse(id).success))
  )
    throw new Error("Select 1–1000 valid employees.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const values: unknown[] = [];
    const where: string[] = [];
    const cond = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replaceAll("?", `$${values.length}`));
    };
    if (self) cond("id=?", req.authUser!.employeeRecordId);
    else {
      values.push(departmentScope(req.authUser!));
      where.push(employeeScopeSql("employees", `$${values.length}`));
      if (ids) cond("id=ANY(?::uuid[])", ids);
      if (options.departmentId) cond("department_id=?", options.departmentId);
      if (options.employmentStatus)
        cond("employment_status=?", options.employmentStatus);
      if (options.q)
        cond(
          "(official_employee_id ILIKE ? OR concat_ws(' ',first_name_en,last_name_en) ILIKE ? OR full_name_bn ILIKE ?)",
          "%" + options.q.replace(/[\\%_]/g, "\\$&") + "%",
        );
    }
    const employees = await client.query<{ id: string }>(
      `SELECT id FROM employees ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY official_employee_id LIMIT 2001`,
      values,
    );
    if (employees.rows.length > 2000)
      throw new Error("Export at most 2000 employees at once; use filters.");
    if (!employees.rowCount) throw new Error("No matching employee records.");
    const rows = await exportRecords(
      client,
      employees.rows.map((e) => e.id),
      !self && options.sensitive === "true",
    );
    const buffer =
      options.format === "xlsx"
        ? await writeXlsx(sheetsFor(rows))
        : Buffer.from(writeCsv(allColumns, rows));
    await recordAudit(client, {
      actorUserId: req.authUser!.userId,
      actorRole: req.authUser!.role,
      action: self ? "PDS_SELF_EXPORTED" : "PDS_ADMIN_EXPORTED",
      entityType: "employee",
      entityId: self ? req.authUser!.employeeRecordId : null,
      metadata: {
        format: options.format,
        scope: self
          ? "self"
          : ids
            ? "selected"
            : where.length
              ? "filtered"
              : "all",
        employeeCount: employees.rowCount,
        unmasked: !self && options.sensitive === "true",
      },
    });
    await client.query("COMMIT");
    return { buffer, format: options.format };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
for (const [self, method] of [
  [true, "get"],
  [false, "get"],
  [false, "post"],
] as const)
  router[method](
    self ? "/me/data/pds" : "/admin/data/pds",
    requireAuth,
    self ? requireActiveEmployee : requireRole("ADMIN"),
    async (req, res, next) => {
      try {
        const result = await exported(req, self);
        res
          .type(result.format === "xlsx" ? mime : "text/csv; charset=utf-8")
          .attachment(
            `ems-${self ? "my-" : " "}pds.${result.format}`.replace(" ", ""),
          )
          .send(result.buffer);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json(bad("Invalid export options."));
          return;
        }
        if (error instanceof Error && !("code" in error)) {
          res
            .status(400)
            .json(bad("Please check your download choices and try again."));
          return;
        }
        next(error);
      }
    },
  );
router.get(
  "/admin/data/template",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    try {
      const parsed = z
        .enum(["csv", "xlsx"])
        .safeParse(req.query.format ?? "xlsx");
      if (!parsed.success) {
        res.status(400).json(bad("Choose CSV or XLSX."));
        return;
      }
      const format = parsed.data;
      const departments = (
        await pool.query(
          "SELECT id,name_en FROM departments WHERE is_active=TRUE AND ($1::uuid IS NULL OR id=$1) ORDER BY name_en",
          [departmentScope(req.authUser!)],
        )
      ).rows;
      res
        .type(format === "xlsx" ? mime : "text/csv; charset=utf-8")
        .attachment(`ems-import-template.${format}`)
        .send(
          format === "xlsx"
            ? await writeXlsx(templateSheets(departments))
            : templateCsv(departments),
        );
    } catch (error) {
      next(error);
    }
  },
);
// Browsers label spreadsheets inconsistently (Excel, Numbers and Windows can all
// send different types), so any non-JSON body is read as bytes and the format is
// decided from the content in the handler below.
const fileBody = express.raw({
  type: (req) => !req.headers["content-type"]?.includes("json"),
  limit: "2mb",
});
const looksLikeXlsx = (body: Buffer) => body[0] === 0x50 && body[1] === 0x4b;
// Known reader failures become reviewed messages; anything else stays generic.
const fileProblems: [RegExp, string][] = [
  [
    /^Formulas are not accepted/,
    "Formulas are not accepted. Paste values before importing.",
  ],
  [
    /^Store employee IDs as text/,
    "Store employee IDs as text so leading zeroes are kept.",
  ],
  [/^Add at least one data row/, "Add at least one data row to the template."],
  [/^Maximum 1000 rows/, "A spreadsheet can have at most 1000 rows."],
];
const fileProblem = (error: unknown) =>
  fileProblems.find(([pattern]) =>
    pattern.test(error instanceof Error ? error.message : ""),
  )?.[1] ??
  "This file could not be opened. Please choose a supported file and try again.";
router.post(
  "/admin/data/files/preview",
  requireAuth,
  requireRole("ADMIN"),
  fileBody,
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        res.status(415).json(bad("Upload a non-empty CSV or XLSX file."));
        return;
      }
      let rows: DataRow[];
      let problem = "";
      try {
        const asXlsx =
          Boolean(req.is(mime)) ||
          Boolean(req.is("application/vnd.ms-excel")) ||
          looksLikeXlsx(req.body);
        rows = asXlsx
          ? await readXlsx(req.body)
          : readCsv(req.body.toString("utf8"));
        if (!rows.length)
          throw new Error("Add at least one data row to the template.");
      } catch (error) {
        problem = fileProblem(error);
        await recordAudit(client, {
          actorUserId: req.authUser!.userId,
          actorRole: "ADMIN",
          action: "IMPORT_FILE_REJECTED",
          entityType: "import",
          entityId: null,
        });
        res.status(400).json(bad(problem));
        return;
      }
      const results = await validateImport(
        client,
        rows,
        false,
        departmentScope(req.authUser!),
        !isRootAdmin(req.authUser!),
      );
      await client.query("BEGIN");
      await client.query("DELETE FROM import_previews WHERE expires_at<NOW()");
      const batch = await client.query<{ id: string }>(
        "INSERT INTO import_previews(actor_user_id,rows_data) VALUES ($1,$2::jsonb) RETURNING id",
        [req.authUser!.userId, JSON.stringify(rows)],
      );
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: "IMPORT_PREVIEWED",
        entityType: "import",
        entityId: batch.rows[0]!.id,
        metadata: {
          rowCount: rows.length,
          invalidRows: results.filter((r) => !r.valid).length,
        },
      });
      await client.query("COMMIT");
      res.json({
        previewId: batch.rows[0]!.id,
        results: results.map((r) => ({
          row: r.row,
          valid: r.valid,
          ...(r.valid
            ? { errors: [], columns: [] }
            : friendlyRowErrors(r.errors)),
          employeeId: r.data.officialEmployeeId,
          rowType: r.data.rowType,
          action: r.data.action,
        })),
        expiresInMinutes: 20,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);
const commitSchema = z.strictObject({
  previewId: z.string().uuid(),
  selected: z.array(z.number().int().min(2).max(1001)).min(1).max(1000),
});
router.post(
  "/admin/data/files/commit",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const input = commitSchema.safeParse(req.body);
    if (!input.success) {
      res.status(400).json(bad("Choose valid preview rows."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const batch = (
        await client.query(
          "SELECT rows_data,consumed_at,expires_at FROM import_previews WHERE id=$1 AND actor_user_id=$2 FOR UPDATE",
          [input.data.previewId, req.authUser!.userId],
        )
      ).rows[0];
      if (
        !batch ||
        batch.consumed_at ||
        new Date(batch.expires_at) <= new Date()
      ) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(
            bad(
              "Preview expired or already committed. Upload the file again.",
              "PREVIEW_UNAVAILABLE",
            ),
          );
        return;
      }
      const selected = [...new Set(input.data.selected)].map(
        (n) => (batch.rows_data as DataRow[])[n - 2],
      );
      if (selected.some((r) => !r)) {
        await client.query("ROLLBACK");
        res.status(400).json(bad("Unknown preview row."));
        return;
      }
      const rows = selected as DataRow[];
      const results = await validateImport(
        client,
        rows,
        true,
        departmentScope(req.authUser!),
        !isRootAdmin(req.authUser!),
      );
      if (results.some((r) => !r.valid)) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: {
            code: "IMPORT_CONFLICT",
            message: INVALID_ENTRY,
          },
          results,
        });
        return;
      }
      const credentials: { employeeId: string; temporaryPassword: string }[] =
        [];
      // Employee creates precede child records regardless of sheet order.
      const validated = results.sort(
        (a, b) =>
          Number(b.data.rowType === "PROFILE") -
          Number(a.data.rowType === "PROFILE"),
      );
      for (const checked of validated) {
        const row = checked.data;
        const payload = checked.payload!;
        const section = RECORD_SECTIONS_BY_SLUG.get(row.rowType!);
        const fields =
          row.rowType === "PROFILE"
            ? EMPLOYEE_UPDATE_FIELDS
            : row.rowType === "SPOUSE"
              ? spouseFields.map(([key, column]) => ({ key, column }))
              : section!.fields;
        const used = fields.filter((f) => Object.hasOwn(payload, f.key));
        const table =
          row.rowType === "PROFILE"
            ? "employees"
            : row.rowType === "SPOUSE"
              ? "employee_spouse"
              : section!.table;
        let employee = (
          await client.query<{ id: string }>(
            "SELECT id FROM employees WHERE official_employee_id=$1",
            [row.officialEmployeeId],
          )
        ).rows[0];
        if (row.action === "CREATE") {
          const first =
            row.rowType === "PROFILE" ? "official_employee_id" : "employee_id";
          const values = [
            row.rowType === "PROFILE" ? row.officialEmployeeId : employee!.id,
            ...used.map((f) => payload[f.key]),
          ];
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO ${table} (${first}${used.length ? "," + used.map((f) => f.column).join(",") : ""}) VALUES (${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
            values,
          );
          if (row.rowType === "PROFILE") {
            employee = inserted.rows[0]!;
            const password = generateTemporaryPassword();
            const hash = await bcrypt.hash(password, env.BCRYPT_COST);
            await client.query(
              "INSERT INTO users(employee_id,password_hash,role,account_status,must_change_password) VALUES ($1,$2,'EMPLOYEE','ACTIVE',TRUE)",
              [employee.id, hash],
            );
            credentials.push({
              employeeId: row.officialEmployeeId!,
              temporaryPassword: password,
            });
          }
        } else {
          const id = row.rowType === "PROFILE" ? employee!.id : row.recordId;
          await client.query(
            `UPDATE ${table} SET ${used.map((f, i) => `${f.column}=$${i + 1}`).join(",")}${used.length ? "," : ""}updated_at=NOW() WHERE id=$${used.length + 1}`,
            [...used.map((f) => payload[f.key]), id],
          );
        }
        await recordAudit(client, {
          actorUserId: req.authUser!.userId,
          actorRole: "ADMIN",
          action: "DATA_IMPORTED",
          entityType: "employee",
          entityId: employee!.id,
          metadata: {
            rowType: row.rowType,
            operation: row.action,
            batchId: input.data.previewId,
          },
        });
      }
      await client.query(
        "UPDATE import_previews SET consumed_at=NOW(),rows_data='[]'::jsonb WHERE id=$1",
        [input.data.previewId],
      );
      await client.query("COMMIT");
      res.json({ count: rows.length, credentials });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = (error as { code?: string }).code;
      // A value the database refuses (unknown department, wrong format, missing
      // required value) is a data-entry mistake, not a server fault.
      if (
        [
          "23503",
          "22P02",
          "22001",
          "22007",
          "22008",
          "23502",
          "23514",
        ].includes(code ?? "")
      ) {
        res.status(409).json(bad(INVALID_ENTRY, "IMPORT_CONFLICT"));
        return;
      }
      if (code === "23505" || code === "40001") {
        res
          .status(409)
          .json(
            bad(
              "Records changed during import. Preview the file again.",
              "IMPORT_CONFLICT",
            ),
          );
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  },
);
export default router;
