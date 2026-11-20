import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  const scriptPath = fileURLToPath(
    new URL("../db/schema.sql", import.meta.url),
  );
  const sql = await readFile(resolve(scriptPath), "utf8");
  await pool.query(sql);
  console.log("EMS database schema created/verified successfully.");
} catch (error) {
  console.error("Database schema setup failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
