import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import bcrypt from "bcrypt";
import { Pool } from "pg";

const required = [
  "NODE_ENV",
  "POSTGRES_DB",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
];
for (const key of required) {
  if (!process.env[key])
    throw new Error(
      `Missing ${key}. Copy .env.test.example to .env.test and configure it.`,
    );
}
if (process.env.NODE_ENV !== "test")
  throw new Error("Tests require NODE_ENV=test.");
if (!/(^|[_-])test($|[_-])/i.test(process.env.POSTGRES_DB ?? "")) {
  throw new Error(
    `Refusing to run tests against database "${process.env.POSTGRES_DB}". The database name must clearly contain "test".`,
  );
}

export const testPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 5,
});

export async function prepareDatabase() {
  const schemaPath = fileURLToPath(
    new URL("../../src/db/schema.sql", import.meta.url),
  );
  const seedPath = fileURLToPath(
    new URL("../../src/db/seed.sql", import.meta.url),
  );
  await testPool.query(await readFile(resolve(schemaPath), "utf8"));
  await testPool.query(await readFile(resolve(seedPath), "utf8"));
  await testPool.query(`
    TRUNCATE TABLE
      audit_logs, change_requests, leave_records, public_holidays,
      professional_memberships, publications, posting_history,
      service_history, training_records, academic_qualifications,
      employee_spouse, users, employees
    RESTART IDENTITY CASCADE
  `);
  await testPool.query("DELETE FROM departments");
  await testPool.query("DELETE FROM leave_types");
  await testPool.query(`
    INSERT INTO departments (name_en) VALUES ('Administration'), ('Operations')
    ON CONFLICT (name_en) DO NOTHING
  `);
}

export async function createFixtures() {
  const adminHash = await bcrypt.hash("Admin-temp-Password-123", 10);
  const employeeHash = await bcrypt.hash("Employee-temp-Password-123", 10);
  const adminEmployee = await testPool.query<{ id: string }>(
    `INSERT INTO employees (official_employee_id, first_name_en, last_name_en, employment_status)
     VALUES ('TEST-ADMIN-001', 'Test', 'Admin', 'ACTIVE') RETURNING id`,
  );
  const admin = await testPool.query<{ id: string }>(
    `INSERT INTO users (employee_id, password_hash, role, admin_scope, is_root, account_status, must_change_password)
     VALUES ($1, $2, 'ADMIN', 'FULL', TRUE, 'ACTIVE', TRUE) RETURNING id`,
    [adminEmployee.rows[0].id, adminHash],
  );
  const employeeRecord = await testPool.query<{ id: string }>(
    `INSERT INTO employees (official_employee_id, first_name_en, last_name_en, employment_status)
     VALUES ('TEST-EMP-001', 'Test', 'Employee', 'ACTIVE') RETURNING id`,
  );
  const employee = await testPool.query<{ id: string }>(
    `INSERT INTO users (employee_id, password_hash, role, admin_scope, account_status, must_change_password)
     VALUES ($1, $2, 'EMPLOYEE', NULL, 'ACTIVE', FALSE) RETURNING id`,
    [employeeRecord.rows[0].id, employeeHash],
  );
  return {
    adminUserId: admin.rows[0].id,
    adminEmployeeRecordId: adminEmployee.rows[0].id,
    employeeUserId: employee.rows[0].id,
    employeeRecordId: employeeRecord.rows[0].id,
  };
}

export async function closeDatabase() {
  await testPool.end();
}
