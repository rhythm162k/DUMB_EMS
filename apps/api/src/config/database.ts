import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { env } from "./env.js";

export const pool = new Pool({
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export const db = drizzle(pool);

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}

type Queryable = Pick<PoolClient, "query">;

export type SchemaReport = {
  // Problems that make the running code fail (missing columns/constraint).
  missing: string[];
  // Problems that do not break requests today but will break a later feature,
  // such as a leftover single-administrator unique index.
  warnings: string[];
};

const REQUIRED_USER_COLUMNS = [
  "admin_scope",
  "administered_department_id",
  "is_root",
];
// Tables the release needs that schema.sql defines but old databases may lack.
const REQUIRED_TABLES = ["import_previews"];

// CI/CD does not run migrations (see docs/OPERATIONS.md). Without this check a
// release deployed ahead of its migration still passes /ready (which only runs
// SELECT 1) while every authenticated request and every sign-in fails with
// "column does not exist". The check reads only the catalog and is cheap enough
// for a health probe. `client` is injectable so tests can inspect another schema.
export async function inspectSchema(
  client: Queryable = pool,
): Promise<SchemaReport> {
  const report: SchemaReport = { missing: [], warnings: [] };
  const table = await client.query<{ present: boolean }>(
    "SELECT to_regclass('users') IS NOT NULL AS present",
  );
  if (!table.rows[0]?.present) {
    report.missing.push("table users");
    return report;
  }

  const columns = await client.query<{ attname: string }>(
    `SELECT attname FROM pg_attribute
     WHERE attrelid = to_regclass('users') AND attnum > 0 AND NOT attisdropped
       AND attname = ANY($1::text[])`,
    [REQUIRED_USER_COLUMNS],
  );
  const present = new Set(columns.rows.map((row) => row.attname));
  for (const column of REQUIRED_USER_COLUMNS)
    if (!present.has(column)) report.missing.push(`users.${column}`);

  for (const name of REQUIRED_TABLES) {
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [name],
    );
    if (!exists.rows[0]?.present) report.missing.push(`table ${name}`);
  }

  const constraint = await client.query(
    `SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('users') AND conname = 'users_admin_scope_check'`,
  );
  if (!constraint.rowCount)
    report.missing.push("constraint users_admin_scope_check");

  const rootConstraint = await client.query(
    `SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('users') AND conname = 'users_root_check'`,
  );
  if (!rootConstraint.rowCount)
    report.missing.push("constraint users_root_check");

  // Any unique index mentioning "role" can only be a one-administrator rule.
  const restriction = await client.query<{ index_name: string }>(
    `SELECT c.relname AS index_name
     FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
     WHERE x.indrelid = to_regclass('users') AND x.indisunique AND NOT x.indisprimary
       AND split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) ILIKE '%role%'`,
  );
  for (const row of restriction.rows)
    report.warnings.push(
      `unique index ${row.index_name} on users still limits administrators`,
    );
  return report;
}
