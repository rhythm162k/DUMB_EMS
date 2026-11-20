import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";

const [employeeId, ...nameParts] = process.argv.slice(2);
const fullName = nameParts.join(" ").trim();

if (
  !employeeId ||
  !fullName ||
  employeeId.length > 50 ||
  fullName.length > 100
) {
  console.error(
    'Usage: npm run auth:seed-admin -- <official-employee-id> "Admin Full Name"',
  );
  process.exitCode = 1;
} else {
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_COST);
  const [firstName, ...lastNameParts] = fullName.split(/\s+/);
  const lastName = lastNameParts.join(" ") || null;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const existingAdmin = await client.query(
      "SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1",
    );
    if (existingAdmin.rowCount) {
      throw new Error(
        "An Admin account already exists. Refusing to create or replace it.",
      );
    }

    const employee = await client.query<{ id: string }>(
      `INSERT INTO employees (
         official_employee_id, department_id, employment_status, first_name_en, last_name_en
       ) VALUES (
         $1,
         (SELECT id FROM departments WHERE name_en = 'Administration' LIMIT 1),
         'ACTIVE', $2, $3
       )
       RETURNING id`,
      [employeeId, firstName, lastName],
    );

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (employee_id, password_hash, role, admin_scope, is_root, account_status, must_change_password)
       VALUES ($1, $2, 'ADMIN', 'FULL', TRUE, 'ACTIVE', TRUE)
       RETURNING id`,
      [employee.rows[0]?.id, passwordHash],
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
       VALUES (NULL, 'SYSTEM', 'ADMIN_ACCOUNT_SEEDED', 'user', $1, '{}'::jsonb)`,
      [user.rows[0]?.id],
    );
    await client.query("COMMIT");

    console.log("EMS Admin account created.");
    console.log(`Employee ID: ${employeeId}`);
    console.log(`Temporary password (shown once): ${temporaryPassword}`);
    console.log("Sign in and change this password immediately.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(
      "Admin account creation failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
