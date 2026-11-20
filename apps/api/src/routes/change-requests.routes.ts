import {
  departmentScope,
  employeeScopeSql,
  assertEmployeeAccess,
  isFullAdmin,
} from "../auth/scope.js";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/database.js";
import { recordAudit } from "../audit/audit.js";
import {
  requireActiveEmployee,
  requireAuth,
  requireRole,
} from "../auth/middleware.js";
import { updateEmployeeSchema } from "../employees/schemas.js";
import {
  EMPLOYEE_UPDATE_FIELDS,
  EMPLOYEE_UPDATE_SELECT,
  normalizeUpdateValue,
} from "../employees/updates.js";
import {
  RECORD_SECTIONS_BY_SLUG,
  dateRangeProblem,
  normalizeRecordValue,
} from "../records/sections.js";
import { lockRecord, currentValues } from "../records/repository.js";
import { upsertSpouseSchema } from "../spouse/schemas.js";
import { SPOUSE_SELECT, type SpouseRow } from "../spouse/repository.js";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const uuid = z.string().uuid();
const requestId = z.object({ requestId: uuid });
const profileFields = new Map(
  EMPLOYEE_UPDATE_FIELDS.filter((f) =>
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
  ).map((f) => [f.key, f]),
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
const decision = z.strictObject({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(1000).optional(),
});
const bad = (message: string, code = "VALIDATION_ERROR") => ({
  error: { code, message },
});
const pageQuery = z.coerce.number().int().min(1).max(100000);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const spouseFields = new Map([
  ["spouseName", "spouse_name"],
  ["spouseOccupation", "spouse_occupation"],
  ["spouseDateOfBirth", "spouse_date_of_birth"],
  ["spouseNationalId", "spouse_national_id"],
]);
const selectProfile = `SELECT ${EMPLOYEE_UPDATE_SELECT} FROM employees WHERE id = $1 FOR UPDATE`;

type RequestRow = {
  id: string;
  employee_id: string;
  submitted_by_user_id: string;
  field_key: string;
  target_record_type: string | null;
  target_record_id: string | null;
  operation: "CREATE" | "UPDATE" | "DELETE";
  old_value_snapshot: unknown;
  proposed_value: unknown;
  status: string;
};

router.get(
  "/me/change-requests",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    const page = pageQuery.safeParse(req.query.page ?? 1);
    if (!page.success) {
      res.status(400).json(bad("Invalid page."));
      return;
    }
    try {
      const rows = await pool.query(
        `SELECT id, field_key AS "fieldKey", target_record_type AS "targetRecordType",
       target_record_id AS "targetRecordId", operation, old_value_snapshot AS "oldValueSnapshot",
       proposed_value AS "proposedValue", status, rejection_reason AS "rejectionReason",
       submitted_at AS "submittedAt", reviewed_at AS "reviewedAt", withdrawn_at AS "withdrawnAt"
       FROM change_requests WHERE employee_id = $1 ORDER BY submitted_at DESC, id DESC LIMIT 50 OFFSET $2`,
        [req.authUser!.employeeRecordId, (page.data - 1) * 50],
      );
      res.json({ items: rows.rows, page: page.data });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/me/change-requests",
  requireAuth,
  requireActiveEmployee,
  (req, res, next) => {
    // Full-access administrators edit their own record directly.
    if (isFullAdmin(req.authUser!)) {
      res
        .status(403)
        .json(
          bad(
            "Full-access administrators update their own details directly.",
            "FORBIDDEN",
          ),
        );
      return;
    }
    next();
  },
  async (req, res, next) => {
    const parsed = proposal.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(bad("Invalid change request."));
      return;
    }
    const input = parsed.data;
    const employeeId = req.authUser!.employeeRecordId;
    if (!employeeId) {
      res.status(404).json(bad("Employee record not found.", "NOT_FOUND"));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes submissions, direct admin edits and reviews that lock the employee.
      const employee = await client.query(
        `SELECT id FROM employees WHERE id = $1 FOR UPDATE`,
        [employeeId],
      );
      if (!employee.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Employee record not found.", "NOT_FOUND"));
        return;
      }
      let fieldKey: string;
      let recordType: string;
      let recordId: string | null = null;
      let oldValue: unknown;
      let proposedValue: unknown;
      if (
        !Object.prototype.hasOwnProperty.call(input, "proposedValue") &&
        input.operation !== "DELETE"
      ) {
        await client.query("ROLLBACK");
        res
          .status(400)
          .json(bad("Proposed value is required (use null to clear)."));
        return;
      }
      if (input.targetRecordType === "PROFILE") {
        const field = profileFields.get(input.fieldKey);
        if (!field) {
          await client.query("ROLLBACK");
          res
            .status(400)
            .json(bad("This profile field is not employee-editable."));
          return;
        }
        const validated = updateEmployeeSchema.safeParse({
          [field.key]: input.proposedValue,
        });
        if (!validated.success) {
          await client.query("ROLLBACK");
          res
            .status(400)
            .json(
              bad("Please check the information you entered and try again."),
            );
          return;
        }
        const current = await client.query<Record<string, unknown>>(
          selectProfile,
          [employeeId],
        );
        oldValue = current.rows[0]?.[field.column] ?? null;
        proposedValue = normalizeUpdateValue(
          (validated.data as Record<string, unknown>)[field.key],
        );
        if (same(oldValue, proposedValue)) {
          await client.query("ROLLBACK");
          res
            .status(409)
            .json(
              bad(
                "The proposed value already matches the official record.",
                "NO_CHANGE",
              ),
            );
          return;
        }
        fieldKey = field.key;
        recordType = "PROFILE";
      } else if (input.targetRecordType === "SPOUSE") {
        if (input.operation === "CREATE") {
          if (input.fieldKey) {
            await client.query("ROLLBACK");
            res
              .status(400)
              .json(bad("A new spouse request uses the complete record."));
            return;
          }
          const checked = upsertSpouseSchema.safeParse(input.proposedValue);
          if (!checked.success) {
            await client.query("ROLLBACK");
            res.status(400).json(bad("Provide valid spouse details."));
            return;
          }
          if (
            (
              await client.query(
                "SELECT id FROM employee_spouse WHERE employee_id=$1",
                [employeeId],
              )
            ).rowCount
          ) {
            await client.query("ROLLBACK");
            res.status(409).json(bad("Spouse record already exists."));
            return;
          }
          fieldKey = "spouse";
          recordType = "SPOUSE";
          oldValue = null;
          proposedValue = checked.data;
        } else {
          const column = spouseFields.get(input.fieldKey ?? "");
          if (!column) {
            await client.query("ROLLBACK");
            res.status(400).json(bad("Unknown spouse field."));
            return;
          }
          const current = await client.query<SpouseRow>(
            `SELECT ${SPOUSE_SELECT} FROM employee_spouse WHERE employee_id = $1 FOR UPDATE`,
            [employeeId],
          );
          if (!current.rowCount) {
            await client.query("ROLLBACK");
            res
              .status(409)
              .json(
                bad(
                  "Spouse record must be created by an administrator first.",
                  "SPOUSE_NOT_FOUND",
                ),
              );
            return;
          }
          const values = {
            spouseName: current.rows[0]!.spouse_name,
            spouseOccupation: current.rows[0]!.spouse_occupation,
            spouseDateOfBirth: current.rows[0]!.spouse_date_of_birth,
            spouseNationalId: current.rows[0]!.spouse_national_id,
          };
          const checked = upsertSpouseSchema.safeParse({
            ...values,
            [input.fieldKey!]: input.proposedValue,
          });
          if (!checked.success) {
            await client.query("ROLLBACK");
            res
              .status(400)
              .json(
                bad("Please check the information you entered and try again."),
              );
            return;
          }
          fieldKey = input.fieldKey!;
          recordType = "SPOUSE";
          recordId = current.rows[0]!.id;
          oldValue = values[fieldKey as keyof typeof values];
          proposedValue = checked.data[fieldKey as keyof typeof checked.data];
          if (same(oldValue, proposedValue)) {
            await client.query("ROLLBACK");
            res.status(409).json(bad("The value is unchanged.", "NO_CHANGE"));
            return;
          }
        }
      } else {
        const section = RECORD_SECTIONS_BY_SLUG.get(input.section);
        if (!section) {
          await client.query("ROLLBACK");
          res.status(400).json(bad("Unknown PDS section."));
          return;
        }
        recordType = `PDS:${section.slug}`;
        recordId = input.targetRecordId ?? null;
        if (input.operation === "CREATE") {
          if (recordId || input.fieldKey) {
            await client.query("ROLLBACK");
            res
              .status(400)
              .json(
                bad(
                  "CREATE must provide a complete record without an ID or field key.",
                ),
              );
            return;
          }
          const checked = section.createSchema.safeParse(input.proposedValue);
          if (!checked.success) {
            await client.query("ROLLBACK");
            res
              .status(400)
              .json(
                bad("Please check the information you entered and try again."),
              );
            return;
          }
          proposedValue = checked.data;
          if (
            dateRangeProblem(section, proposedValue as Record<string, unknown>)
          ) {
            await client.query("ROLLBACK");
            res.status(400).json(bad("End date cannot precede start date."));
            return;
          }
          fieldKey = section.slug;
          oldValue = null;
        } else {
          if (!recordId) {
            await client.query("ROLLBACK");
            res.status(400).json(bad("Record ID is required."));
            return;
          }
          const row = await lockRecord(client, section, employeeId, recordId);
          if (!row) {
            await client.query("ROLLBACK");
            res.status(404).json(bad("PDS record not found.", "NOT_FOUND"));
            return;
          }
          const values = currentValues(section, row);
          if (input.operation === "DELETE") {
            if (input.fieldKey || input.proposedValue !== undefined) {
              await client.query("ROLLBACK");
              res
                .status(400)
                .json(bad("DELETE must not provide a field or value."));
              return;
            }
            fieldKey = section.slug;
            oldValue = values;
            proposedValue = null;
          } else {
            const field = section.fields.find((f) => f.key === input.fieldKey);
            if (!field) {
              await client.query("ROLLBACK");
              res.status(400).json(bad("Unknown PDS field."));
              return;
            }
            const checked = section.updateSchema.safeParse({
              [field.key]: input.proposedValue,
            });
            if (!checked.success) {
              await client.query("ROLLBACK");
              res
                .status(400)
                .json(
                  bad(
                    "Please check the information you entered and try again.",
                  ),
                );
              return;
            }
            fieldKey = field.key;
            oldValue = values[field.key];
            proposedValue = normalizeRecordValue(
              (checked.data as Record<string, unknown>)[field.key],
            );
            if (same(oldValue, proposedValue)) {
              await client.query("ROLLBACK");
              res.status(409).json(bad("The value is unchanged.", "NO_CHANGE"));
              return;
            }
            if (
              dateRangeProblem(section, {
                ...values,
                [fieldKey]: proposedValue,
              })
            ) {
              await client.query("ROLLBACK");
              res.status(400).json(bad("End date cannot precede start date."));
              return;
            }
          }
        }
      }
      const duplicate = await client.query(
        `SELECT 1 FROM change_requests WHERE employee_id = $1 AND status = 'PENDING'
       AND target_record_type = $2 AND target_record_id IS NOT DISTINCT FROM $3 AND field_key = $4 AND operation = $5 LIMIT 1`,
        [employeeId, recordType, recordId, fieldKey, input.operation],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(
            bad(
              "A request for this change is already pending.",
              "DUPLICATE_REQUEST",
            ),
          );
        return;
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO change_requests (employee_id, submitted_by_user_id, field_key, target_record_type,
       target_record_id, operation, old_value_snapshot, proposed_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING id`,
        [
          employeeId,
          req.authUser!.userId,
          fieldKey,
          recordType,
          recordId,
          input.operation,
          JSON.stringify(oldValue ?? null),
          JSON.stringify(proposedValue ?? null),
        ],
      );
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: req.authUser!.role,
        action: "CHANGE_REQUEST_SUBMITTED",
        entityType: "change_request",
        entityId: inserted.rows[0]!.id,
        fieldKey,
      });
      await client.query("COMMIT");
      res.status(201).json({ id: inserted.rows[0]!.id, status: "PENDING" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

router.post(
  "/me/change-requests/:requestId/withdraw",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    const params = requestId.safeParse(req.params);
    if (!params.success) {
      res.status(400).json(bad("Invalid request ID."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query<{ id: string }>(
        `UPDATE change_requests SET status = 'WITHDRAWN', withdrawn_at = NOW()
       WHERE id = $1 AND employee_id = $2 AND status = 'PENDING' RETURNING id`,
        [params.data.requestId, req.authUser!.employeeRecordId],
      );
      if (!changed.rowCount) {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(
            bad(
              "Request is not pending or does not belong to you.",
              "REQUEST_UNAVAILABLE",
            ),
          );
        return;
      }
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: req.authUser!.role,
        action: "CHANGE_REQUEST_WITHDRAWN",
        entityType: "change_request",
        entityId: changed.rows[0]!.id,
      });
      await client.query("COMMIT");
      res.json({ status: "WITHDRAWN" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

router.get(
  "/admin/change-requests",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const page = pageQuery.safeParse(req.query.page ?? 1);
    if (!page.success) {
      res.status(400).json(bad("Invalid page."));
      return;
    }
    try {
      const status = z
        .enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "ALL"])
        .safeParse(req.query.status ?? "PENDING");
      if (!status.success) {
        res.status(400).json(bad("Invalid status filter."));
        return;
      }
      const result = await pool.query(
        `SELECT cr.id, cr.employee_id AS "employeeId", e.official_employee_id AS "officialEmployeeId",
       e.first_name_en AS "employeeName", cr.field_key AS "fieldKey", cr.target_record_type AS "targetRecordType",
       cr.target_record_id AS "targetRecordId", cr.operation, cr.old_value_snapshot AS "oldValueSnapshot",
       cr.proposed_value AS "proposedValue", cr.status, cr.rejection_reason AS "rejectionReason",
       cr.submitted_at AS "submittedAt", cr.reviewed_at AS "reviewedAt",
       NULLIF(CONCAT_WS(' ', re.first_name_en, re.last_name_en), '') AS "reviewedByName",
       re.official_employee_id AS "reviewedByOfficialId"
       FROM change_requests cr JOIN employees e ON e.id = cr.employee_id
       LEFT JOIN users ru ON ru.id = cr.reviewed_by_user_id
       LEFT JOIN employees re ON re.id = ru.employee_id
       WHERE ($1::text = 'ALL' OR cr.status = $1) AND ${employeeScopeSql("e", "$3")} ORDER BY cr.submitted_at DESC, cr.id DESC LIMIT 50 OFFSET $2`,
        [status.data, (page.data - 1) * 50, departmentScope(req.authUser!)],
      );
      res.json({ items: result.rows, page: page.data });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/admin/change-requests/:requestId/decision",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = requestId.safeParse(req.params);
    const parsed = decision.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json(bad("Invalid review decision."));
      return;
    }
    if (parsed.data.action === "REJECT" && !parsed.data.reason) {
      res.status(400).json(bad("A rejection reason is required."));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Lock employee first, then request: matches submission's lock order.
      const locator = await client.query<{ employee_id: string }>(
        "SELECT employee_id FROM change_requests WHERE id = $1",
        [params.data.requestId],
      );
      if (!locator.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json(bad("Request not found.", "NOT_FOUND"));
        return;
      }
      await client.query("SELECT id FROM employees WHERE id = $1 FOR UPDATE", [
        locator.rows[0]!.employee_id,
      ]);
      await assertEmployeeAccess(
        req.authUser!,
        locator.rows[0]!.employee_id,
        client,
      );
      const locked = await client.query<RequestRow>(
        "SELECT * FROM change_requests WHERE id = $1 FOR UPDATE",
        [params.data.requestId],
      );
      const request = locked.rows[0];
      if (!request || request.status !== "PENDING") {
        await client.query("ROLLBACK");
        res
          .status(409)
          .json(
            bad("This request is no longer pending.", "REQUEST_UNAVAILABLE"),
          );
        return;
      }
      if (parsed.data.action === "APPROVE") {
        if (request.target_record_type === "PROFILE") {
          const field = profileFields.get(request.field_key);
          if (!field || request.operation !== "UPDATE") {
            await client.query("ROLLBACK");
            res
              .status(409)
              .json(bad("Unsupported change request.", "REQUEST_INVALID"));
            return;
          }
          const current = await client.query<Record<string, unknown>>(
            selectProfile,
            [request.employee_id],
          );
          if (
            !same(current.rows[0]?.[field.column], request.old_value_snapshot)
          ) {
            await client.query("ROLLBACK");
            res
              .status(409)
              .json(
                bad(
                  "Official data changed since submission. Reject this request and ask for a new one.",
                  "CHANGE_CONFLICT",
                ),
              );
            return;
          }
          await client.query(
            `UPDATE employees SET ${field.column} = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
            [request.proposed_value, req.authUser!.userId, request.employee_id],
          );
        } else if (request.target_record_type === "SPOUSE") {
          if (request.operation === "CREATE") {
            const checked = upsertSpouseSchema.safeParse(
              request.proposed_value,
            );
            const exists = await client.query(
              "SELECT id FROM employee_spouse WHERE employee_id=$1",
              [request.employee_id],
            );
            if (!checked.success || exists.rowCount) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(
                  bad(
                    "Spouse record changed since submission.",
                    "CHANGE_CONFLICT",
                  ),
                );
              return;
            }
            const d = checked.data;
            await client.query(
              "INSERT INTO employee_spouse(employee_id,spouse_name,spouse_occupation,spouse_date_of_birth,spouse_national_id) VALUES ($1,$2,$3,$4,$5)",
              [
                request.employee_id,
                d.spouseName,
                d.spouseOccupation,
                d.spouseDateOfBirth,
                d.spouseNationalId,
              ],
            );
          } else {
            const column = spouseFields.get(request.field_key);
            if (
              !column ||
              request.operation !== "UPDATE" ||
              !request.target_record_id
            ) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(bad("Invalid spouse request.", "REQUEST_INVALID"));
              return;
            }
            const spouse = await client.query<SpouseRow>(
              `SELECT ${SPOUSE_SELECT} FROM employee_spouse WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
              [request.target_record_id, request.employee_id],
            );
            if (
              !spouse.rowCount ||
              !same(
                spouse.rows[0]![column as keyof SpouseRow],
                request.old_value_snapshot,
              )
            ) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(
                  bad(
                    "Spouse information changed since submission.",
                    "CHANGE_CONFLICT",
                  ),
                );
              return;
            }
            await client.query(
              `UPDATE employee_spouse SET ${column} = $1, updated_at = NOW() WHERE id = $2 AND employee_id = $3`,
              [
                request.proposed_value,
                request.target_record_id,
                request.employee_id,
              ],
            );
          }
        } else if (request.target_record_type?.startsWith("PDS:")) {
          const section = RECORD_SECTIONS_BY_SLUG.get(
            request.target_record_type.slice(4),
          );
          if (!section) {
            await client.query("ROLLBACK");
            res
              .status(409)
              .json(bad("Unknown PDS section.", "REQUEST_INVALID"));
            return;
          }
          if (request.operation === "CREATE") {
            const checked = section.createSchema.safeParse(
              request.proposed_value,
            );
            if (
              !checked.success ||
              dateRangeProblem(section, checked.data as Record<string, unknown>)
            ) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(
                  bad("Proposed record is no longer valid.", "CHANGE_CONFLICT"),
                );
              return;
            }
            const data = checked.data as Record<string, unknown>;
            const columns = section.fields.filter(
              (f) => data[f.key] !== undefined,
            );
            await client.query(
              `INSERT INTO ${section.table} (employee_id, ${columns.map((f) => f.column).join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})`,
              [
                request.employee_id,
                ...columns.map((f) => normalizeRecordValue(data[f.key])),
              ],
            );
          } else {
            if (!request.target_record_id) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(bad("Missing target record.", "REQUEST_INVALID"));
              return;
            }
            const row = await lockRecord(
              client,
              section,
              request.employee_id,
              request.target_record_id,
            );
            if (!row) {
              await client.query("ROLLBACK");
              res
                .status(409)
                .json(bad("The target record was removed.", "CHANGE_CONFLICT"));
              return;
            }
            const values = currentValues(section, row);
            if (request.operation === "DELETE") {
              if (!same(values, request.old_value_snapshot)) {
                await client.query("ROLLBACK");
                res
                  .status(409)
                  .json(
                    bad("Record changed since submission.", "CHANGE_CONFLICT"),
                  );
                return;
              }
              await client.query(
                `DELETE FROM ${section.table} WHERE id = $1 AND employee_id = $2`,
                [request.target_record_id, request.employee_id],
              );
            } else {
              const field = section.fields.find(
                (f) => f.key === request.field_key,
              );
              if (
                !field ||
                !same(values[field.key], request.old_value_snapshot) ||
                dateRangeProblem(section, {
                  ...values,
                  [request.field_key]: request.proposed_value,
                })
              ) {
                await client.query("ROLLBACK");
                res
                  .status(409)
                  .json(
                    bad(
                      "Record changed or proposed value is invalid.",
                      "CHANGE_CONFLICT",
                    ),
                  );
                return;
              }
              await client.query(
                `UPDATE ${section.table} SET ${field.column} = $1, updated_at = NOW() WHERE id = $2 AND employee_id = $3`,
                [
                  request.proposed_value,
                  request.target_record_id,
                  request.employee_id,
                ],
              );
            }
          }
        } else {
          await client.query("ROLLBACK");
          res
            .status(409)
            .json(bad("Unsupported request type.", "REQUEST_INVALID"));
          return;
        }
      }
      const newStatus =
        parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED";
      await client.query(
        `UPDATE change_requests SET status = $1, reviewed_at = NOW(), reviewed_by_user_id = $2, rejection_reason = $3 WHERE id = $4`,
        [
          newStatus,
          req.authUser!.userId,
          newStatus === "REJECTED" ? parsed.data.reason : null,
          request.id,
        ],
      );
      await recordAudit(client, {
        actorUserId: req.authUser!.userId,
        actorRole: "ADMIN",
        action: `CHANGE_REQUEST_${newStatus}`,
        entityType: "change_request",
        entityId: request.id,
        fieldKey: request.field_key,
        reason: newStatus === "REJECTED" ? parsed.data.reason : undefined,
        metadata: {
          employeeId: request.employee_id,
          operation: request.operation,
        },
      });
      await client.query("COMMIT");
      res.json({ status: newStatus });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  },
);

export default router;
