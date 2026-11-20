import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { testPool, closeDatabase } from "./helpers/database.js";

afterAll(closeDatabase);
it("migrates legacy accounts without data loss, removes the single-admin index, and reruns safely", async () => {
  const sql = await readFile(
    new URL("../src/db/migrations/001_admin_scopes.sql", import.meta.url),
    "utf8",
  );
  const client = await testPool.connect();
  const schema = `scope_migration_test_${randomUUID().replaceAll("-", "")}`;
  try {
    // Isolated schema inside the dedicated test database, never the application's public schema.
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE departments(id UUID PRIMARY KEY);
      CREATE TABLE users(id UUID PRIMARY KEY, role TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE UNIQUE INDEX users_single_admin_idx ON users(role) WHERE role='ADMIN'`);
    const adminId = randomUUID(),
      employeeId = randomUUID(),
      department = randomUUID();
    await client.query("INSERT INTO departments VALUES($1)", [department]);
    await client.query(
      "INSERT INTO users VALUES($1,'ADMIN','preserved-admin-hash'),($2,'EMPLOYEE','preserved-employee-hash')",
      [adminId, employeeId],
    );
    await client.query(sql);
    expect(
      (
        await client.query(
          "SELECT role,admin_scope,administered_department_id,password_hash FROM users WHERE id=$1",
          [adminId],
        )
      ).rows[0],
    ).toEqual({
      role: "ADMIN",
      admin_scope: "FULL",
      administered_department_id: null,
      password_hash: "preserved-admin-hash",
    });
    expect(
      (
        await client.query(
          "SELECT admin_scope,administered_department_id,password_hash FROM users WHERE id=$1",
          [employeeId],
        )
      ).rows[0],
    ).toEqual({
      admin_scope: null,
      administered_department_id: null,
      password_hash: "preserved-employee-hash",
    });
    await client.query(
      "UPDATE users SET role='ADMIN',admin_scope='DEPARTMENT',administered_department_id=$1 WHERE id=$2",
      [department, employeeId],
    );
    await client.query(sql);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM users WHERE role='ADMIN'",
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await client.query(
          "SELECT admin_scope,administered_department_id FROM users WHERE id=$1",
          [employeeId],
        )
      ).rows[0],
    ).toEqual({
      admin_scope: "DEPARTMENT",
      administered_department_id: department,
    });
    await expect(
      client.query(
        "UPDATE users SET administered_department_id=NULL WHERE id=$1",
        [employeeId],
      ),
    ).rejects.toThrow();
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});

it("root migration marks only the oldest active full admin, is repeatable, and enforces one root", async () => {
  const read = (name: string) =>
    readFile(new URL(`../src/db/migrations/${name}`, import.meta.url), "utf8");
  const [scopes, root] = [
    await read("001_admin_scopes.sql"),
    await read("002_root_admin.sql"),
  ];
  const client = await testPool.connect();
  const schema = `root_migration_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE departments(id UUID PRIMARY KEY);
      CREATE TABLE users(id UUID PRIMARY KEY, role TEXT NOT NULL, password_hash TEXT NOT NULL,
        account_status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const original = randomUUID(),
      delegated = randomUUID(),
      employee = randomUUID();
    await client.query(
      `INSERT INTO users(id,role,password_hash,created_at) VALUES
        ($1,'ADMIN','h1','2026-01-01'),($2,'ADMIN','h2','2026-06-01'),($3,'EMPLOYEE','h3','2026-02-01')`,
      [original, delegated, employee],
    );
    await client.query(scopes);
    await client.query(root);
    const roots = () =>
      client
        .query("SELECT id FROM users WHERE is_root")
        .then((r) => r.rows.map((row) => row.id));
    expect(await roots()).toEqual([original]);
    // Rerunning, even after the original admin is demoted by hand, never moves the root.
    await client.query(
      "UPDATE users SET account_status='DISABLED' WHERE id=$1",
      [original],
    );
    await client.query(root);
    expect(await roots()).toEqual([original]);
    // Data preserved.
    expect(
      (
        await client.query("SELECT password_hash FROM users WHERE id=$1", [
          delegated,
        ])
      ).rows[0].password_hash,
    ).toBe("h2");
    // At most one root, and the root must be a full-access administrator.
    await expect(
      client.query("UPDATE users SET is_root=TRUE WHERE id=$1", [delegated]),
    ).rejects.toThrow();
    await expect(
      client.query("UPDATE users SET is_root=TRUE WHERE id=$1", [employee]),
    ).rejects.toThrow();
    await expect(
      client.query(
        "UPDATE users SET admin_scope=NULL, role='EMPLOYEE' WHERE id=$1",
        [original],
      ),
    ).rejects.toThrow();
    // More than one administrator remains possible.
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM users WHERE role='ADMIN'",
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
  }
});
