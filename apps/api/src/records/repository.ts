import type { PoolClient } from "pg";
import { pool } from "../config/database.js";
import { RECORD_SECTIONS, type RecordSection } from "./sections.js";

type RecordRow = Record<string, unknown> & {
  id: string;
  created_at: Date;
  updated_at: Date;
};

// Identifiers below come from the static section registry, never from the client.
// DATE columns are formatted in SQL so the pg driver cannot shift them by the server timezone.
function selectList(section: RecordSection): string {
  const columns = section.fields.map((field) =>
    field.isDate
      ? `to_char(${field.column}, 'YYYY-MM-DD') AS ${field.column}`
      : field.column,
  );
  return ["id", ...columns, "created_at", "updated_at"].join(", ");
}

export function toRecordJson(section: RecordSection, row: RecordRow) {
  const json: Record<string, unknown> = { id: row.id };
  for (const field of section.fields)
    json[field.key] = row[field.column] ?? null;
  json.createdAt = row.created_at;
  json.updatedAt = row.updated_at;
  return json;
}

// Current stored values keyed by API field name (used for change detection and range checks).
export function currentValues(
  section: RecordSection,
  row: RecordRow,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of section.fields)
    values[field.key] = row[field.column] ?? null;
  return values;
}

export async function listSectionRecords(
  section: RecordSection,
  employeeId: string,
) {
  const result = await pool.query<RecordRow>(
    `SELECT ${selectList(section)} FROM ${section.table} WHERE employee_id = $1 ORDER BY ${section.orderBy}`,
    [employeeId],
  );
  return result.rows.map((row) => toRecordJson(section, row));
}

// Every repeatable section for one employee, keyed by each section's response key.
export async function listAllRecords(employeeId: string) {
  const entries = await Promise.all(
    RECORD_SECTIONS.map(
      async (section) =>
        [
          section.responseKey,
          await listSectionRecords(section, employeeId),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

export async function getRecord(
  section: RecordSection,
  employeeId: string,
  recordId: string,
) {
  const result = await pool.query<RecordRow>(
    `SELECT ${selectList(section)} FROM ${section.table} WHERE id = $1 AND employee_id = $2`,
    [recordId, employeeId],
  );
  const row = result.rows[0];
  return row ? toRecordJson(section, row) : undefined;
}

// Locks the row for the rest of the transaction. The employee_id condition is the ownership
// check: a record id that belongs to another employee is treated as not found.
export async function lockRecord(
  client: PoolClient,
  section: RecordSection,
  employeeId: string,
  recordId: string,
) {
  const result = await client.query<RecordRow>(
    `SELECT ${selectList(section)} FROM ${section.table} WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
    [recordId, employeeId],
  );
  return result.rows[0];
}
