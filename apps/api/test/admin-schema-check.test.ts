import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { inspectSchema } from "../src/config/database.js";
import {
  closeDatabase,
  prepareDatabase,
  testPool,
} from "./helpers/database.js";

afterAll(closeDatabase);

const migrationSql = () =>
  readFile(
    new URL("../src/db/migrations/001_admin_scopes.sql", import.meta.url),
    "utf8",
  );
const rootMigrationSql = () =>
  readFile(
    new URL("../src/db/migrations/002_root_admin.sql", import.meta.url),
    "utf8",
  );

// Builds a legacy (pre-scope) users table in a throw-away schema inside the test
// database, never in the application's public schema.
async function withLegacySchema(
  legacyDdl: string,
  run: (client: PoolClient, schema: string) => Promise<void>,
) {
  const client = await testPool.connect();
  const schema = `scope_schema_check_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE departments(id UUID PRIMARY KEY);
      CREATE TABLE users(id UUID PRIMARY KEY, role TEXT NOT NULL, password_hash TEXT NOT NULL, account_status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      ${legacyDdl}`);
    await run(client, schema);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
}

describe("schema compatibility check (readiness)", () => {
  it("reports a migrated schema as compatible", async () => {
    await prepareDatabase();
    expect(await inspectSchema(testPool)).toEqual({
      missing: [],
      warnings: [],
    });
  });

  it("reports an un-migrated database as behind the release, then clean after migrating", async () => {
    await withLegacySchema("", async (client) => {
      const before = await inspectSchema(client);
      expect(before.missing).toEqual([
        "users.admin_scope",
        "users.administered_department_id",
        "users.is_root",
        "table import_previews",
        "constraint users_admin_scope_check",
        "constraint users_root_check",
      ]);
      await client.query(await migrationSql());
      await client.query(await rootMigrationSql());
      expect(await inspectSchema(client)).toEqual({
        missing: [],
        warnings: [],
      });
    });
  });
});

describe("single-administrator restriction removal", () => {
  it("is detected and removed even when the legacy index has a different name", async () => {
    await withLegacySchema(
      "CREATE UNIQUE INDEX only_one_boss ON users((role = 'ADMIN')) WHERE role = 'ADMIN'",
      async (client, schema) => {
        expect((await inspectSchema(client)).warnings).toEqual([
          "unique index only_one_boss on users still limits administrators",
        ]);
        await client.query(await migrationSql());
        await client.query(await rootMigrationSql());
        expect(await inspectSchema(client)).toEqual({
          missing: [],
          warnings: [],
        });
        const indexes = await client.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'users'",
          [schema],
        );
        // Only the primary key and the single-root index remain; nothing limits administrators.
        expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
          "users_pkey",
          "users_single_root_idx",
        ]);
        // Two full administrators were impossible before the migration.
        await client.query(
          `INSERT INTO users (id, role, password_hash, admin_scope)
           VALUES (gen_random_uuid(), 'ADMIN', 'a', 'FULL'), (gen_random_uuid(), 'ADMIN', 'b', 'FULL')`,
        );
      },
    );
  });

  it("removes a unique-constraint form of the restriction", async () => {
    await withLegacySchema(
      "ALTER TABLE users ADD CONSTRAINT users_role_unique UNIQUE (role)",
      async (client) => {
        await client.query(await migrationSql());
        const constraints = await client.query<{ conname: string }>(
          "SELECT conname FROM pg_constraint WHERE conrelid = to_regclass('users') AND contype = 'u'",
        );
        expect(constraints.rows).toEqual([]);
        await client.query(await rootMigrationSql());
        expect(await inspectSchema(client)).toEqual({
          missing: [],
          warnings: [],
        });
      },
    );
  });

  it("leaves unrelated unique indexes alone", async () => {
    await withLegacySchema(
      "ALTER TABLE users ADD COLUMN employee_id UUID; CREATE UNIQUE INDEX users_employee_id_key ON users(employee_id)",
      async (client, schema) => {
        await client.query(await migrationSql());
        const indexes = await client.query<{ indexname: string }>(
          "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'users' ORDER BY indexname",
          [schema],
        );
        expect(indexes.rows.map((row) => row.indexname)).toEqual([
          "users_employee_id_key",
          "users_pkey",
        ]);
      },
    );
  });
});
