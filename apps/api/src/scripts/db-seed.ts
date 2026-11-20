import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { env } from "../config/env.js";

const pool = new Pool({
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
  connectionTimeoutMillis: 5_000,
});

try {
  const scriptPath = fileURLToPath(new URL("../db/seed.sql", import.meta.url));
  const sql = await readFile(scriptPath, "utf8");
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
  console.log("EMS reference data seeded successfully.");
} catch (error) {
  console.error("Database seed failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
